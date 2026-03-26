.PHONY: build serve new-post

build:
	uv run --script build.py build

serve:
	uv run --script build.py serve

new-post:
ifndef TITLE
	$(error Usage: make new-post TITLE="My Post Title")
endif
	$(eval SLUG := $(shell echo "$(TITLE)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$$//'))
	$(eval DATE := $(shell date -R))
	$(eval FILE := posts/$(SLUG).md)
	@if [ -f "$(FILE)" ]; then echo "Error: $(FILE) already exists"; exit 1; fi
	@echo '---' > $(FILE)
	@echo 'title: $(TITLE)' >> $(FILE)
	@echo 'template: post' >> $(FILE)
	@echo 'author: c7lo' >> $(FILE)
	@echo 'date: $(DATE)' >> $(FILE)
	@echo '---' >> $(FILE)
	@echo '' >> $(FILE)
	@echo 'Write your post here.' >> $(FILE)
	@echo "Created $(FILE)"
