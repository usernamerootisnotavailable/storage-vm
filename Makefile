SHELL := /usr/bin/env bash

VENV ?= $(CURDIR)/.venv
PYTHON ?= python3
ANSIBLE_PLAYBOOK ?= $(VENV)/bin/ansible-playbook
ANSIBLE_GALAXY ?= $(VENV)/bin/ansible-galaxy
ANSIBLE_LINT ?= $(VENV)/bin/ansible-lint
YAMLLINT ?= $(VENV)/bin/yamllint
MOLECULE ?= $(VENV)/bin/molecule
TOFU ?= tofu
TFLINT ?= tflint
TOFU_VERSION ?= 1.12.12
TFLINT_VERSION ?= 0.66.0
ENV ?=
DRY_RUN ?=
COLLECTIONS := $(CURDIR)/collections

export ANSIBLE_CONFIG := $(CURDIR)/ansible.cfg
export ANSIBLE_COLLECTIONS_PATH := $(COLLECTIONS)
export PATH := $(VENV)/bin:$(PATH)
export TOFU_BIN := $(TOFU)
export TOFU_VERSION
export TFLINT_VERSION

.PHONY: help deps lint syntax check literals generate sysctl test-image molecule dev-up dev-down deploy-dev-check deploy-dev verify integration secrets-dev secrets-prod tf-init tf-fmt tf-validate tf-lint tf-plan tf-apply tf-check test clean

help:
	@echo "Storage Host targets:"
	@echo "  make deps               Create the venv and install pinned dependencies"
	@echo "  make generate ENV=dev|prod [DRY_RUN=1]  Create the encrypted environment files"
	@echo "  make lint INVENTORY=...  yamllint, ansible-lint, policy, and literal checks"
	@echo "  make syntax INVENTORY=...  Syntax-check all playbooks"
	@echo "  make check INVENTORY=...  Lint and syntax checks"
	@echo "  make literals           Check tracked files for environment literals"
	@echo "  make test-image         Build the AlmaLinux 10 systemd test image"
	@echo "  make molecule           Run the Molecule scenarios (requires Docker)"
	@echo "  make dev-up             Start the development container"
	@echo "  make dev-down           Stop the development container"
	@echo "  make secrets-dev        Create the encrypted development files"
	@echo "  make secrets-prod       Create the encrypted production files"
	@echo "  make deploy-dev-check   Check mode against development"
	@echo "  make deploy-dev         Apply to development"
	@echo "  make verify             Verify development"
	@echo "  make integration        Full apply, verify, and idempotence check"
	@echo "  make tf-init ENV=...    Initialize OpenTofu and select the environment workspace"
	@echo "  make tf-fmt ENV=...     Check OpenTofu formatting"
	@echo "  make tf-validate ENV=...  Validate the OpenTofu module"
	@echo "  make tf-lint ENV=...    Run tflint"
	@echo "  make tf-check ENV=...   OpenTofu init, fmt, validate, and tflint"
	@echo "  make tf-plan ENV=...    Plan the environment (requires SOPS key)"
	@echo "  make tf-apply ENV=...   Apply the environment (requires SOPS key)"
	@echo "  make test               check plus Molecule"

$(VENV)/bin/ansible:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -r requirements-dev.txt

deps: $(VENV)/bin/ansible
	$(ANSIBLE_GALAXY) collection install -r requirements.yml -p ./collections --force

lint: deps
	@test -n "$(INVENTORY)" || { echo "Set INVENTORY=path/to/hosts.yml" >&2; exit 2; }
	$(YAMLLINT) .
	ANSIBLE_INVENTORY="$(INVENTORY)" $(ANSIBLE_LINT)
	./scripts/check-policy.sh
	./scripts/check-literals.sh

syntax: deps
	@test -n "$(INVENTORY)" || { echo "Set INVENTORY=path/to/hosts.yml" >&2; exit 2; }
	@for playbook in site.yml playbooks/*.yml; do \
		echo "Checking $$playbook"; \
		$(ANSIBLE_PLAYBOOK) -i "$(INVENTORY)" "$$playbook" --syntax-check; \
	done

check: lint syntax

literals:
	./scripts/check-literals.sh

generate:
	@test -n "$(ENV)" || { echo "Usage: make generate ENV=dev|prod [DRY_RUN=1]" >&2; exit 2; }
	./scripts/generate.sh "$(ENV)" $(if $(filter 1 true yes,$(DRY_RUN)),--dry-run,)

tf-init:
	@test -n "$(ENV)" || { echo "Set ENV=dev or ENV=prod" >&2; exit 2; }
	./scripts/tofu.sh "$(ENV)" init

tf-fmt:
	@test -n "$(ENV)" || { echo "Set ENV=dev or ENV=prod" >&2; exit 2; }
	./scripts/tofu.sh "$(ENV)" fmt

tf-validate:
	@test -n "$(ENV)" || { echo "Set ENV=dev or ENV=prod" >&2; exit 2; }
	./scripts/tofu.sh "$(ENV)" validate

tf-lint:
	@test -n "$(ENV)" || { echo "Set ENV=dev or ENV=prod" >&2; exit 2; }
	@command -v "$(TFLINT)" >/dev/null 2>&1 || { echo "tflint not found: $(TFLINT)" >&2; exit 1; }
	@$(TFLINT) --version | grep -q "TFLint version $(TFLINT_VERSION)" || { \
		echo "tflint $(TFLINT_VERSION) is required" >&2; exit 1; }
	cd tofu && $(TFLINT) --config .tflint.hcl

tf-plan:
	@test -n "$(ENV)" || { echo "Set ENV=dev or ENV=prod" >&2; exit 2; }
	./scripts/tofu.sh "$(ENV)" plan

tf-apply:
	@test -n "$(ENV)" || { echo "Set ENV=dev or ENV=prod" >&2; exit 2; }
	./scripts/tofu.sh "$(ENV)" apply

tf-check: tf-init tf-fmt tf-validate tf-lint

sysctl:
	@current=$$(sysctl -n vm.max_map_count 2>/dev/null || echo 0); \
	if [ "$$current" -lt 262144 ]; then \
		if sudo -n true 2>/dev/null; then \
			sudo sysctl -w vm.max_map_count=262144; \
		else \
			echo "WARNING: vm.max_map_count is $$current; Elasticsearch may fail." >&2; \
		fi; \
	fi

test-image:
	docker build -t storage-host/almalinux10-ansible:10 docker/dev

molecule: test-image sysctl
	@set -e; \
	for role in common postgresql mariadb garage elasticsearch nginx; do \
		echo "== Molecule: $$role"; \
		cd "$(CURDIR)/roles/$$role"; \
		$(MOLECULE) test; \
	done

dev-up:
	./scripts/dev-up.sh

dev-down:
	./scripts/dev-down.sh

deploy-dev-check: deps
	$(ANSIBLE_PLAYBOOK) -i inventories/dev/hosts.yml site.yml --check --diff

deploy-dev: deps
	$(ANSIBLE_PLAYBOOK) -i inventories/dev/hosts.yml site.yml

verify: deps
	$(ANSIBLE_PLAYBOOK) -i inventories/dev/hosts.yml playbooks/verify.yml

integration: deps
	ANSIBLE_PLAYBOOK=$(ANSIBLE_PLAYBOOK) ./scripts/integration-test.sh

secrets-dev:
	./scripts/generate.sh dev $(if $(filter 1 true yes,$(DRY_RUN)),--dry-run,)

secrets-prod:
	./scripts/generate.sh prod $(if $(filter 1 true yes,$(DRY_RUN)),--dry-run,)

test: check molecule

clean:
	rm -rf .cache .molecule
