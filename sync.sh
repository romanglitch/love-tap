#!/bin/bash
export $(grep -v '^#' .env | xargs)
export OPEN_WEBUI_URL="$OIKB_SERVER_URL"
export OPEN_WEBUI_API_KEY="$OIKB_API_KEY"

oikb sync . --kb-id "$OIKB_KNOWLEDGE_ID"