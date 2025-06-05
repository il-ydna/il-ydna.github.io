import json
import boto3
from boto3.dynamodb.conditions import Key
from decimal import Decimal
import uuid
import traceback

def decimal_to_native(obj):
    if isinstance(obj, list):
        return [decimal_to_native(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: decimal_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    else:
        return obj

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("Posts")  # replace with your table name if different

def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method")
    path = event.get("rawPath")

    print("Received event:")
    print(json.dumps(event, indent=2))  # Log incoming event for debugging

    if method == "OPTIONS":
        return cors_response(200, {"message": "CORS preflight successful"})

    if path != "/":
        return cors_response(404, {"message": "Not Found"})

    if method == "GET":
        try:
            resp = table.scan()
            items = resp.get("Items", [])
            items = decimal_to_native(items)
            return cors_response(200, items)
        except Exception as e:
            tb = traceback.format_exc()
            print(f"GET error: {tb}")
            return cors_response(500, {"error": str(e), "traceback": tb})

    elif method == "POST":
        try:
            body_str = event.get("body", "{}")
            print(f"POST body: {body_str}")

            body = json.loads(body_str)

            required_fields = ["title", "content", "timestamp"]
            for field in required_fields:
                if field not in body:
                    msg = f"Missing field: {field}"
                    print(msg)
                    return cors_response(400, {"error": msg})

            # Add a unique ID to the post
            body["id"] = str(uuid.uuid4())

            # Optionally validate that image, if present, is a string or empty
            if "image" in body and body["image"] is None:
                body["image"] = ""

            print(f"Putting item to DynamoDB: {body}")

            table.put_item(Item=body)
            return cors_response(200, {"message": "Post saved successfully", "id": body["id"]})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"POST error: {tb}")
            return cors_response(500, {"error": str(e), "traceback": tb})
    elif method == "DELETE":
        try:
            # Get query parameters
            qs_params = event.get("queryStringParameters") or {}
            post_id = qs_params.get("id")

            if not post_id:
                msg = "Missing 'id' query parameter"
                print(msg)
                return cors_response(400, {"error": msg})

            # Attempt to delete the item with the given id
            response = table.delete_item(
                Key={"id": post_id},
                ConditionExpression="attribute_exists(id)"  # only delete if it exists
            )
            
            # Check if item was actually deleted
            if response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 200:
                return cors_response(200, {"message": f"Post {post_id} deleted successfully"})
            else:
                return cors_response(500, {"error": "Failed to delete post"})

        except boto3.client('dynamodb').exceptions.ConditionalCheckFailedException:
            msg = f"Post with id {post_id} does not exist"
            print(msg)
            return cors_response(404, {"error": msg})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"DELETE error: {tb}")
            return cors_response(500, {"error": str(e), "traceback": tb})

        else:
            return cors_response(405, {"error": "Method Not Allowed"})

def cors_response(status_code, body_dict):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps(body_dict)
    }
