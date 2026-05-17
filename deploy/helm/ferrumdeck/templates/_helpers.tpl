{{/* vim: set filetype=mustache: */}}

{{/* Expand the chart name */}}
{{- define "ferrumdeck.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name */}}
{{- define "ferrumdeck.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Chart name+version label */}}
{{- define "ferrumdeck.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels */}}
{{- define "ferrumdeck.labels" -}}
helm.sh/chart: {{ include "ferrumdeck.chart" . }}
{{ include "ferrumdeck.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ferrumdeck
{{- end -}}

{{/* Selector labels */}}
{{- define "ferrumdeck.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ferrumdeck.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Per-component labels */}}
{{- define "ferrumdeck.componentLabels" -}}
{{ include "ferrumdeck.labels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Per-component selector labels */}}
{{- define "ferrumdeck.componentSelectorLabels" -}}
{{ include "ferrumdeck.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Resolve image tag (fallback to chart appVersion) */}}
{{- define "ferrumdeck.image" -}}
{{- $tag := .tag | default .root.Chart.AppVersion -}}
{{- printf "%s:%s" .repository $tag -}}
{{- end -}}

{{/* Secret name — either the externally-managed one or the rendered Secret */}}
{{- define "ferrumdeck.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "ferrumdeck.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* ConfigMap name */}}
{{- define "ferrumdeck.configMapName" -}}
{{- printf "%s-config" (include "ferrumdeck.fullname" .) -}}
{{- end -}}

{{/* Gateway service URL — used by worker + dashboard when controlPlaneUrl unset */}}
{{- define "ferrumdeck.gatewayUrl" -}}
{{- if .Values.config.controlPlaneUrl -}}
{{- .Values.config.controlPlaneUrl -}}
{{- else -}}
{{- printf "http://%s-gateway:%d" (include "ferrumdeck.fullname" .) (int .Values.gateway.service.port) -}}
{{- end -}}
{{- end -}}

{{/* Auto-derived database URL when bundled postgres is enabled and the user
     didn't provide one. Falls back to the user-supplied secret data. */}}
{{- define "ferrumdeck.databaseUrl" -}}
{{- if .Values.secrets.data.databaseUrl -}}
{{- .Values.secrets.data.databaseUrl -}}
{{- else if .Values.postgresql.enabled -}}
{{- $user := .Values.postgresql.auth.username -}}
{{- $pass := .Values.postgresql.auth.password -}}
{{- $db := .Values.postgresql.auth.database -}}
{{- $host := printf "%s-postgresql" .Release.Name -}}
{{- printf "postgres://%s:%s@%s:5432/%s" $user $pass $host $db -}}
{{- else -}}
{{- "" -}}
{{- end -}}
{{- end -}}

{{/* Auto-derived redis URL when bundled redis is enabled. */}}
{{- define "ferrumdeck.redisUrl" -}}
{{- if .Values.secrets.data.redisUrl -}}
{{- .Values.secrets.data.redisUrl -}}
{{- else if .Values.redis.enabled -}}
{{- $host := printf "%s-redis-master" .Release.Name -}}
{{- printf "redis://%s:6379" $host -}}
{{- else -}}
{{- "" -}}
{{- end -}}
{{- end -}}
