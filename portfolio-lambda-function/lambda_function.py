import json
import boto3
from boto3.dynamodb.conditions import Key
from decimal import Decimal
import uuid
import traceback
import os
import base64
from botocore.exceptions import ClientError
from botocore.config import Config
from urllib.parse import urlparse

s3 = boto3.client(
    's3',
    region_name=os.environ['REGION_NAME'],
    config=Config(signature_version='s3v4')
)
bucket_name = os.environ['S3_BUCKET_NAME']

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ['TABLE_NAME']) 

# helper funcs
def get_user_claims(event):
    """
    Pull Cognito JWT claims that API Gateway’s authorizer injects.
    """
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"]
    except KeyError:
        # Shouldn’t happen unless the route isn’t protected
        return {}

def decimal_to_native(obj):
    if isinstance(obj, list):
        return [decimal_to_native(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: decimal_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    else:
        return obj

def upload_image_to_s3(base64_str, post_id):
    try:
        if ',' in base64_str:
            base64_str = base64_str.split(",")[1]

        image_bytes = base64.b64decode(base64_str)
        key = f"posts/{post_id}.jpg"

        s3.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=image_bytes,
            ContentType='image/jpeg',
            ACL='public-read'  # Make the image public
        )

        # Public URL format for S3 objects
        public_url = f"https://{bucket_name}.s3.{s3.meta.region_name}.amazonaws.com/{key}"

        print(f"Uploaded image to {public_url}")
        return public_url

    except Exception as e:
        print(f"Error uploading image: {e}")
        raise


def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path = event.get("rawPath")

    print("Received event:")
    print(json.dumps(event, indent=2))  # Log incoming event for debugging

    if path != "/":
        return cors_response(404, {"message": "Not Found"})

    if method == "OPTIONS":
        return handle_options(event)

    qs = event.get("queryStringParameters") or {}
    if method == "GET" and "presign" in qs:
        return handle_presign(event)

    if method == "GET":
        return handle_get(event)

    if method == "POST":
        return handle_post(event)

    if method == "DELETE":
        return handle_delete(event)
    
    if method == "PUT":
        return handle_put(event)

    return cors_response(405, {"error": "Method Not Allowed"})

# handlers
def handle_options(event):
    return cors_response(200, {"message": "CORS preflight successful"})


def handle_get(event):
    try:
        resp = table.scan()
        items = resp.get("Items", [])
        items = decimal_to_native(items)
        response = cors_response(200, items)
        print("GET response headers:", response["headers"])  # ✅ add this
        return response
    except Exception as e:
        tb = traceback.format_exc()
        print(f"GET error: {tb}")
        return cors_response(500, {"error": str(e), "traceback": tb})

def handle_presign(event):
    try:
        claims = get_user_claims(event)
        user_sub = claims.get("sub", "anonymous")

        qs = event.get("queryStringParameters") or {}
        post_id = qs.get("post_id")
        index = qs.get("index", "0")

        if not post_id:
            return cors_response(400, {"error": "Missing post_id"})

        key = f"posts/{post_id}_{index}.jpg"

        url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": bucket_name,
                "Key": key,
                "ContentType": "image/jpeg",
                "ACL": "public-read"  # ✅ THIS MUST MATCH YOUR FRONTEND UPLOAD HEADERS
            },
            ExpiresIn=300
        )

        public_url = f"https://{bucket_name}.s3.{s3.meta.region_name}.amazonaws.com/{key}"
        return cors_response(200, {"upload_url": url, "public_url": public_url})

    except Exception as e:
        return cors_response(500, {"error": str(e), "traceback": traceback.format_exc()})


def handle_post(event):
    try:
        claims = get_user_claims(event)
        user_sub   = claims.get("sub")
        user_email = claims.get("email")

        body = json.loads(event.get("body", "{}"))
        for field in ["title", "content", "timestamp"]:
            if field not in body:
                return cors_response(400, {"error": f"Missing field: {field}"})

        post_id = str(uuid.uuid4())
        post_item = {
            "id": post_id,
            "userId": user_sub,
            "userEmail": user_email,
            "title": body.get("title"),
            "content": body.get("content"),
            "tag": body.get("tag", "general"),
            "timestamp": body.get("timestamp"),
            "images": body.get("images", []), 
            "layout": body.get("layout", "grid"),
            "pageOwnerId": user_sub  # Optional but future-proof
        }

        table.put_item(Item=post_item)
        return cors_response(200, {"message": "Post saved successfully", "id": post_id})

    except Exception as e:
        tb = traceback.format_exc()
        print(f"POST error: {tb}")
        return cors_response(500, {"error": str(e), "traceback": tb})



def handle_delete(event):
    try:
        claims = get_user_claims(event)
        user_sub = claims.get("sub")

        qs_params = event.get("queryStringParameters") or {}
        post_id = qs_params.get("id")
        if not post_id:
            return cors_response(400, {"error": "Missing 'id' query parameter"})

        # Get the post to validate and retrieve image key
        resp = table.get_item(Key={"id": post_id})
        item = resp.get("Item")
        if not item:
            return cors_response(404, {"error": f"Post {post_id} not found"})

        post_owner = item.get("userId")
        page_owner = item.get("pageOwnerId")

        if user_sub != post_owner and user_sub != page_owner:
            return cors_response(403, {"error": "Not authorized to delete this post"})

        image_urls = item.get("images", [])
        for url in image_urls:
            parsed_url = urlparse(url)
            key = parsed_url.path.lstrip('/')
            try:
                s3.delete_object(Bucket=bucket_name, Key=key)
                print(f"Deleted image {key} from S3")
            except Exception as e:
                print(f"Error deleting image {key} from S3: {e}")


        # Delete post from DynamoDB
        response = table.delete_item(
            Key={"id": post_id},
            ConditionExpression="attribute_exists(id)"
        )

        if response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 200:
            return cors_response(200, {"message": f"Post {post_id} deleted successfully"})
        else:
            return cors_response(500, {"error": "Failed to delete post"})

    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return cors_response(404, {"error": f"Post with id {post_id} does not exist"})
        else:
            raise
    except Exception as e:
        tb = traceback.format_exc()
        return cors_response(500, {"error": str(e), "traceback": tb})

def handle_put(event):
    try:
        claims = get_user_claims(event)
        user_sub = claims.get("sub")

        body = json.loads(event.get("body", "{}"))
        post_id = body.get("id")

        if not post_id:
            return cors_response(400, {"error": "Missing post ID"})

        # Fetch the existing post to verify ownership
        resp = table.get_item(Key={"id": post_id})
        item = resp.get("Item")

        if not item:
            return cors_response(404, {"error": f"Post {post_id} not found"})
        print(f"user_sub: {user_sub}")
        print(f"item.userId: {item.get('userId')}")
        print(f"equal: {item.get('userId') == user_sub}")
        if item.get("userId") != user_sub:
            return cors_response(403, {"error": "Not your post"})

        new_images = body.get("images", [])
        existing_images = item.get("images", [])

        # Delete all old images from S3 if new images are provided
        if new_images and new_images != existing_images:
            for url in existing_images:
                parsed_url = urlparse(url)
                key = parsed_url.path.lstrip('/')
                try:
                    s3.delete_object(Bucket=bucket_name, Key=key)
                except Exception as e:
                    print(f"Failed to delete old image: {e}")

            uploaded = []
            for idx, base64_img in enumerate(new_images):
                if base64_img:
                    uploaded.append(upload_image_to_s3(base64_img, f"{post_id}_{idx}"))
            body["images"] = uploaded
        else:
            body["images"] = existing_images


        # Only allow certain fields to be updated
        allowed_fields = ["title", "content", "tag", "images", "layout", "timestamp"]
        updated_data = {k: v for k, v in body.items() if k in allowed_fields}
        updated_data["id"] = post_id
        updated_data["userId"] = user_sub
        updated_data["userEmail"] = claims.get("email")

        table.put_item(Item=updated_data)

        return cors_response(200, {"message": "Post updated successfully"})

    except Exception as e:
        tb = traceback.format_exc()
        return cors_response(500, {"error": str(e), "traceback": tb})

def cors_response(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE, PUT",
            "Access-Control-Allow-Headers": "Content-Type,Authorization"
        },
        "body": json.dumps(body_dict)
    }
