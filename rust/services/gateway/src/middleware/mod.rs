//! Middleware modules

pub mod auth;
pub mod oauth2;
pub mod rate_limit;
pub mod request_id;

pub use auth::{auth_middleware, AuthContext};
#[allow(unused_imports)]
pub use auth::require_scope;
pub use oauth2::{create_oauth2_validator, OAuth2Config, OAuth2Validator};
pub use rate_limit::{create_rate_limiter, rate_limit_middleware, RateLimiter};
pub use request_id::request_id_middleware;
#[allow(unused_imports)]
pub use request_id::RequestId;
