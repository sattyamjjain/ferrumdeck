//! OpenTelemetry setup

use opentelemetry::trace::TracerProvider;
use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{runtime, trace as sdktrace, Resource};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize OpenTelemetry with OTLP exporter
pub fn init_telemetry(
    service_name: &str,
    otlp_endpoint: Option<&str>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Build resource with service name
    let resource = Resource::new(vec![KeyValue::new(
        "service.name",
        service_name.to_string(),
    )]);

    // Set up OTLP tracer if endpoint is provided
    let tracer = if let Some(endpoint) = otlp_endpoint {
        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .with_endpoint(endpoint)
            .build()?;

        let provider = sdktrace::TracerProvider::builder()
            .with_batch_exporter(exporter, runtime::Tokio)
            .with_resource(resource)
            .build();

        let tracer = provider.tracer(service_name.to_string());
        global::set_tracer_provider(provider);
        Some(tracer)
    } else {
        None
    };

    // Build the subscriber
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    let registry = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer);

    if let Some(tracer) = tracer {
        let otel_layer = tracing_opentelemetry::layer().with_tracer(tracer);
        registry.with(otel_layer).init();
    } else {
        registry.init();
    }

    Ok(())
}

/// Shutdown OpenTelemetry
pub fn shutdown_telemetry() {
    global::shutdown_tracer_provider();
}
