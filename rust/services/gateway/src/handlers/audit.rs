//! Audit-record reads.
//!
//! `GET /v1/audit/{event_id}` exists because the realtime stream promises one.
//! `policy.response.recorded` carries the `record_id` of the decision row it
//! describes (issue #5), and that field is only evidence if a consumer can
//! resolve it — otherwise the event is asserting the existence of something
//! nobody can check, which is the shape of claim this repository spends most of
//! its CI gates rejecting.
//!
//! ## A finding this route does not fix
//!
//! The dashboard's BFF has proxied `GET /v1/audit?<query>` (the LIST endpoint)
//! since before this change, and **the gateway has never served that route** —
//! `rg 'route\("/audit' rust/` matched nothing. The proxy therefore forwards to
//! a 404. `scripts/check_route_backing.py` counts the BFF route as backed
//! because it contains a real `fetch(`, which is true and not the same as the
//! target existing. This module adds only the by-id read the SSE work needs;
//! the list endpoint and the checker's blind spot are recorded in the branch
//! notes rather than fixed in passing.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::state::AppState;

/// `GET /v1/audit/{event_id}` — read one audit record by id.
///
/// Tenant-scoped: a record belonging to another tenant is reported as absent
/// rather than as forbidden, so the endpoint cannot be used to probe which ids
/// exist elsewhere.
pub async fn get_audit_event(
    State(state): State<AppState>,
    axum::Extension(auth): axum::Extension<crate::middleware::AuthContext>,
    Path(event_id): Path<String>,
) -> Response {
    match state.repos().audit().get(&event_id).await {
        Ok(Some(row)) => {
            let same_tenant = match (&row.tenant_id, &auth.tenant_id) {
                (Some(row_tenant), caller) => row_tenant == caller,
                // Pre-migration / global rows carry no tenant. Readable, since
                // they are not scoped to anyone.
                (None, _) => true,
            };
            if !same_tenant {
                return not_found(&event_id);
            }
            Json(row).into_response()
        }
        Ok(None) => not_found(&event_id),
        Err(e) => {
            tracing::error!(error = %e, event_id = %event_id, "reading audit event");
            super::ApiError::internal("failed to read the audit event").into_response()
        }
    }
}

fn not_found(event_id: &str) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": {
                "code": "AUDIT_EVENT_NOT_FOUND",
                "message": format!(
                    "No audit event {event_id} is readable by this tenant. If this id came \
                     from a `policy.response.recorded` event, that is a defect worth \
                     reporting: the event is published only after the record commits."
                ),
            }
        })),
    )
        .into_response()
}
