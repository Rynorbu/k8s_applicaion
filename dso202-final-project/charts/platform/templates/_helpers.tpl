{{- define "platform.labels" -}}
app.kubernetes.io/part-of: spendwise
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "platform.secretEnv" -}}
- name: {{ index . 0 }}
  valueFrom:
    secretKeyRef:
      name: {{ index . 1 }}
      key: {{ index . 2 }}
{{- end -}}
