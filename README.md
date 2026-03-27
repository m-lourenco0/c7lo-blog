# c7lo.com

Personal blog and space on the internet. Built with a custom Python static site generator, WebGL shaders, and deployed to Cloudflare Pages.

## Stack

- Python + [uv](https://github.com/astral-sh/uv) (build)
- [Minijinja](https://github.com/mitsuhiko/minijinja) (templates)
- WebGL (background shaders)
- [htmx](https://htmx.org) (navigation)
- Cloudflare Pages (hosting)

## Development

```bash
make serve    # local dev server
make build    # build to _build/
```

## New post

```bash
make new-post TITLE="My Post Title"
```
