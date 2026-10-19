package fathom

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// Fathom's OAuth and API (docs/adr/0008); tests point them at a fake. The authorize URL isn't in Fathom's
// docs: it's the one their SDK uses. The token URL is the docs'.
var (
	AuthorizeURL = "https://fathom.video/external/v1/oauth2/authorize"
	TokenURL     = "https://api.fathom.ai/external/v1/oauth2/token"
	API          = "https://api.fathom.ai/external/v1"
)

// Scope is the only one Fathom has: its API, as the person who connected.
const Scope = "public_api"

// Webhook is one Fathom made for a member: its id, to delete it, and the secret it signs deliveries with.
type Webhook struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
}

// CreateWebhook asks Fathom to post the member's meetings to destination once their notes are ready: the
// ones they recorded, whether or not they shared them with a team, with the summary and action items.
func CreateWebhook(ctx context.Context, client *http.Client, accessToken, destination string) (Webhook, error) {
	body, _ := json.Marshal(map[string]any{
		"destination_url":      destination,
		"triggered_for":        []string{"my_recordings", "my_shared_with_team_recordings"},
		"include_summary":      true,
		"include_action_items": true,
	})
	var hook Webhook
	if err := call(ctx, client, http.MethodPost, API+"/webhooks", accessToken, body, http.StatusCreated, &hook); err != nil {
		return Webhook{}, fmt.Errorf("creating the webhook: %w", err)
	}
	if hook.ID == "" || hook.Secret == "" {
		return Webhook{}, fmt.Errorf("creating the webhook: Fathom's answer has no id or secret")
	}
	if _, err := Key(hook.Secret); err != nil {
		return Webhook{}, fmt.Errorf("creating the webhook: %w", err)
	}
	return hook, nil
}

// DeleteWebhook stops a webhook. One Fathom no longer has counts as deleted.
func DeleteWebhook(ctx context.Context, client *http.Client, accessToken, id string) error {
	err := call(ctx, client, http.MethodDelete, API+"/webhooks/"+url.PathEscape(id), accessToken, nil, http.StatusNoContent, nil)
	if err != nil {
		return fmt.Errorf("deleting webhook %s: %w", id, err)
	}
	return nil
}

func call(ctx context.Context, client *http.Client, method, target, accessToken string, body []byte, want int, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if method == http.MethodDelete && (resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNotFound) {
		return nil
	}
	if resp.StatusCode != want {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("fathom answered %s: %s", resp.Status, bytes.TrimSpace(detail))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}
