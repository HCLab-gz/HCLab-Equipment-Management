package authz.user

default allow := false

# Public registration is guarded by a one-use, email-bound full-score exam proof.
# All other resources retain CloudBase platform authorization and database RLS.
allow if {
  input.cloudbase.resource_type == "functions"
  input.request.path == "/v1/functions/hclab-register"
  input.request.method == "POST"
}
