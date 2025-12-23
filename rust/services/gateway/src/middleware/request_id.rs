//! Request ID middleware

use axum::{
    extract::Request,
    http::HeaderValue,
    middleware::Next,
    response::Response,
};
use ulid::Ulid;

const REQUEST_ID_HEADER: &str = "x-request-id";

/// Request ID context
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct RequestId(pub String);

/// Add or propagate request ID
pub async fn request_id_middleware(mut request: Request, next: Next) -> Response {
    // Get existing or generate new request ID
    let request_id = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("req_{}", Ulid::new()));

    // Add to extensions for handlers
    request.extensions_mut().insert(RequestId(request_id.clone()));

    // Run the handler
    let mut response = next.run(request).await;

    // Add to response headers
    if let Ok(header_value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(REQUEST_ID_HEADER, header_value);
    }

    response
}
