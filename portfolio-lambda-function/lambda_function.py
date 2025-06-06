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

    if method == "GET":
        return handle_get(event)

    if method == "POST":
        return handle_post(event)

    if method == "DELETE":
        return handle_delete(event)

    return cors_response(405, {"error": "Method Not Allowed"})

# handlers
def handle_options(event):
    return cors_response(200, {"message": "CORS preflight successful"})


def handle_get(event):
    try:
        resp = table.scan()
        items = resp.get("Items", [])
        items = decimal_to_native(items)
        return cors_response(200, items)
    except Exception as e:
        tb = traceback.format_exc()
        print(f"GET error: {tb}")
        return cors_response(500, {"error": str(e), "traceback": tb})


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
        body.update({
            "id": post_id,
            "userId": user_sub,
            "userEmail": user_email
        })

        image_base64 = body.get("image", "")
        if image_base64:
            body["image"] = upload_image_to_s3(image_base64, post_id)
        else:
            body["image"] = ""

        table.put_item(Item=body)
        return cors_response(200, {"message": "Post saved successfully", "id": post_id})

    except Exception as e:
        tb = traceback.format_exc()
        print(f"POST error: {tb}")
        return cors_response(500, {"error": str(e), "traceback": tb})



def handle_delete(event):
    try:
        claims   = get_user_claims(event)
        user_sub = claims.get("sub")

        post_id = (event.get("queryStringParameters") or {}).get("id")
        if not post_id:
            return cors_response(400, {"error": "Missing 'id' query parameter"})

        resp  = table.get_item(Key={"id": post_id})
        item  = resp.get("Item")
        if not item:
            return cors_response(404, {"error": f"Post {post_id} not found"})

        # 🚫 If the caller isn’t the owner, block the delete
        if item.get("userId") != user_sub:
            return cors_response(403, {"error": "Not your post"})
        print('trying to delete here yay')
        qs_params = event.get("queryStringParameters") or {}
        post_id = qs_params.get("id")
        if not post_id:
            return cors_response(400, {"error": "Missing 'id' query parameter"})

        # 1. Get the post item first to retrieve the image key
        resp = table.get_item(Key={"id": post_id})
        item = resp.get("Item")

        if not item:
            return cors_response(404, {"error": f"Post with id {post_id} does not exist"})

        # 2. Delete image from S3 if it exists
        image_url = item.get("image", "")
        print(f"Image URL from DynamoDB: {image_url}")
        if image_url:
            parsed_url = urlparse(image_url)
            key = parsed_url.path.lstrip('/')
            print(f"Parsed S3 key: '{key}' from URL: {image_url}")

            try:
                s3.delete_object(Bucket=bucket_name, Key=key)
                print(f"Deleted image {key} from S3")
            except Exception as e:
                print(f"Error deleting image from S3: {e}")

        # 3. Delete post from DynamoDB
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

def cors_response(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "Content-Type,Authorization"
        },
        "body": json.dumps(body_dict)
    }
