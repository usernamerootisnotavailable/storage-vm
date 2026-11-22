# Contributing

## Workflow

1. Create a branch from `main`.
2. Read `AGENTS.md` and the documents relevant to the change.
3. Make the smallest coherent change.
4. Add or update tests and documentation in the same branch.
5. Run the required checks.
6. Open a pull request with the verification evidence.
7. Merge only after review and passing required checks.

Direct pushes to `main` are forbidden. Production deployment is a separate, approved action.

## Commit style

Use Conventional Commits:

```text
feat(postgresql): add TLS verification task
fix(common): restrict SSH to approved CIDRs
docs(secrets): document age key rotation
test(postgresql): cover backup timer
chore(deps): pin community.sops 2.5.1
```

Keep commits focused. A role change, its tests, and its documentation may be one commit. Unrelated refactors belong elsewhere.

## Pull request checklist

- [ ] The change follows `AGENTS.md`.
- [ ] No plaintext secret, age key, or private key is added.
- [ ] No environment branching or host-specific logic was introduced.
- [ ] Variables are prefixed, typed, documented, and validated.
- [ ] Versions and collections are pinned.
- [ ] `make lint` passes.
- [ ] `make syntax` passes.
- [ ] The affected Molecule scenario passes.
- [ ] Integration passes for playbook or inventory changes.
- [ ] The second run reports `changed=0`.
- [ ] `gitleaks` passes.
- [ ] SELinux/firewall changes have a real-host verification plan.
- [ ] Documentation is updated.
- [ ] Destructive changes include backup and rollback steps.

## Adding a role

1. Confirm the component is approved and documented in `docs/COMPONENTS.md`.
2. Verify AlmaLinux 10 package support and record the exact tested version.
3. Create the role skeleton:
   - `defaults/main.yml`
   - `handlers/main.yml`
   - `meta/main.yml`
   - `meta/argument_specs.yml`
   - `tasks/main.yml`
   - `templates/`
   - `molecule/default/`
   - `README.md`
4. Use the role-name prefix for every variable.
5. Install all target-side dependencies in the role.
6. Add handlers for service restarts.
7. Add verification tasks that prove the service works, not just that it is running.
8. Add the playbook and import it into `site.yml` before verification.
9. Update `README.md`, `docs/ARCHITECTURE.md`, and `docs/COMPONENTS.md`.

## Changing a variable

- Additive variables may be added with a default.
- Required variables must be declared in `argument_specs`.
- Renaming requires a deprecation period and an inventory migration.
- Never silently change the meaning or units of an existing variable.
- Remove duplicates from other layers when moving a value.

## Changing secrets

Changes to `.sops.yaml` or age recipients require security review.

For a new secret:

1. Add the `secret_*` key to the appropriate environment file.
2. Map it in `group_vars/storage/main.yml`.
3. Declare the mapped variable with `no_log: true`.
4. Use `no_log` on tasks that consume it.
5. Add the rotation procedure to the component document.
6. Verify the file is encrypted and only the intended recipient can decrypt it.

Never commit a decrypted file, even temporarily.

## Changing versions

1. Change the version in both environments' `versions.yml`, unless a documented staged rollout requires temporary drift.
2. Read the vendor upgrade notes and identify breaking changes.
3. Add a backup step for stateful services.
4. Test in development.
5. Record the tested package version in `docs/COMPONENTS.md`.
6. Deploy to production with a rollback plan.

## Emergency changes

If a production incident requires an out-of-band change:

1. Make the smallest change needed to restore service.
2. Record exactly what changed and why.
3. Open a pull request that encodes the change.
4. Deploy the code path as soon as possible.
5. Review whether detection, testing, or documentation failed.

Emergency changes do not exempt the change from later review.

## Review focus

Reviewers should prioritize:

1. Secret exposure and credential handling
2. Environment independence
3. Idempotence and check-mode safety
4. Data safety and rollback
5. Security controls (SELinux, firewall, TLS, users, permissions)
6. Test coverage and verification quality
7. Documentation accuracy

Style issues are secondary to those concerns.
