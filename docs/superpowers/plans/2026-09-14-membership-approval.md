# Membership approval implementation plan

**Goal:** Applicants request ordinary-member or administrator access after a 100-point exam; the designated super administrator must approve membership before any equipment actions are available.

**Architecture:** Store native credentials through existing CloudBase Auth, with the business profile initially pending and without administrative powers. The private application record preserves requested role, exam provenance and review audit. PostgreSQL enforces approval and role boundaries. Only a database-owner operation can appoint the initial super administrator, using the existing identity verified against the user's name and email; never infer that privilege from registration fields.

**Scope:** CloudBase Shanghai production and the local demo. Keep the optional Supabase adapter consistent through a migration. Keep existing admitted members admitted. Keep GitHub Pages unpublished. No emails or credentials in source-controlled bootstrap fixtures; notifications use the existing in-site bell. Existing passwords remain managed by the authentication provider.

- [x] Add PostgreSQL tests for pending ordinary/admin applicants, full marks, private RPC denial, role forgery, replay/idempotency, approval/rejection, isolated data, and super-admin inheritance.
- [x] Add migration `20260914000005_membership_approval.sql`: profile status and super role, private application audit, guarded reviewer RPC, notifications, revised profile creation and role binding. Add matching optional Supabase migration.
- [x] Pass `requested_role` through the trusted registration handler, validating only `user`/`admin` and never granting a requested role automatically. Retain identity verification and password handling. Test malformed roles and default old-client behavior.
- [x] Add shared membership/role helpers and service types. Update CloudBase/Supabase adapters and local demo. Pending users may read their own profile/application/notices; approved members gain normal functionality.
- [x] Update registration with requested identity and a fourth review stage. Add applicant status and super-only review UI with name, email, student ID, project, requested identity, exam score, date, approval and rejection reason. Reuse the existing notice bell and 30-second/focus refresh.
- [x] Update role-aware navigation, administrator selectors and permission labels. Update rules and README so the displayed onboarding requirements match the workflow.
- [x] Run full tests/build, inspect local registration/review/status screens, and review backend permissions. Deploy migration then cloud function, and verify cloud schema/functions read-only.
- [x] Promote only the verified existing profile through owner SQL with ID/name/email guards. Verify its effective super-admin and approved status.

Delivery: commit and push the tested changes, then confirm CI passes with Pages deployment skipped.

Validation: 97 Vitest tests and 8 registration-handler tests passed; TypeScript/Vite build passed. Browser verification used an isolated local demo: a full-mark administrator application stayed pending and was redirected away from equipment pages; super-admin approval granted administrator access without exposing registration review to that new administrator. No synthetic account was created in the live environment. The cloud migration and registration function were deployed; read-only checks confirmed one approved super administrator and denied anonymous review / direct client provisioning.

Key cases: anonymous/pending/rejected/ordinary/admin cannot review; forged requested super role fails; pending applicants cannot book, upload or edit assets; ordinary admins do not receive or see others' membership requests; approval grants exactly the recorded requested role; duplicate requests/review retries do not create accounts, duplicate notifications or reset credentials; historical exam scores and existing members are preserved.
