{{- define "spendwise.labels" -}}
app.kubernetes.io/part-of: spendwise
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
spendwise.io/environment: {{ .Values.global.environment }}
{{- end -}}

{{- define "spendwise.secretName" -}}
{{- if .Values.secrets.existingSecret -}}{{ .Values.secrets.existingSecret }}{{- else -}}spendwise-secrets{{- end -}}
{{- end -}}

{{/* Image reference for a component: <registry>/<name>:<tag> */}}
{{- define "spendwise.image" -}}
{{- $root := index . 0 -}}{{- $name := index . 1 -}}{{- $override := index . 2 -}}
{{- printf "%s/%s:%s" $root.Values.image.registry $name (default $root.Values.image.tag $override) -}}
{{- end -}}

{{/* Environment variable list sourcing a value from the shared secret. */}}
{{- define "spendwise.secretEnv" -}}
- name: {{ index . 0 }}
  valueFrom:
    secretKeyRef:
      name: {{ index . 1 }}
      key: {{ index . 2 }}
      optional: {{ if gt (len .) 3 }}{{ index . 3 }}{{ else }}false{{ end }}
{{- end -}}
