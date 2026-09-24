# invariant-data

Loaders that turn public datasets into Invariant's common JSONL format (`LabeledDocument`).
See [ADR-0004](../../docs/adr/0004-docile-as-raw-research-data.md).

## DocILE

1. Request access at <https://docile.rossum.ai> (research use). A download token arrives by email.
2. Get the official download script and fetch the annotated split into the git-ignored `data/` folder (run from the repo root):

   ```sh
   git clone --depth 1 https://github.com/rossumai/docile.git /tmp/docile
   /tmp/docile/download_dataset.sh "$DOCILE_TOKEN" labeled-trainval data/docile --unzip
   ```

3. Explore and export (from `python/data`):

   ```sh
   uv run invariant-data docile-stats ../../data/docile train
   uv run invariant-data docile-export ../../data/docile train --out ../../data/processed/docile-train.jsonl
   ```

Never commit the token or any downloaded data.

## Development

```sh
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
```
