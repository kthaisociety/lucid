package growth

import (
	"net/mail"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSESSignsInWithAPasswordDerivedFromTheSecretKey(t *testing.T) {
	from := &mail.Address{Name: "Lucid", Address: "lucid@example.com"}
	cfg := SES("AKIAEXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "eu-north-1", from, nil)

	assert.Equal(t, "email-smtp.eu-north-1.amazonaws.com", cfg.Host)
	assert.Equal(t, "AKIAEXAMPLE", cfg.Username)
	// AWS's conversion (smtp-credentials-convert), worked out with its documented Python script.
	assert.Equal(t, "BPfy85A/4ChxYc0s4mIG5bpIlvRl5AP1uupODe8KaHpf", cfg.Password)
}

func TestAMessageCarriesReplyToWhenSet(t *testing.T) {
	from := &mail.Address{Name: "Lucid", Address: "lucid@example.com"}
	to := &mail.Address{Name: "Kim Ek", Address: "kim@example.com"}
	msg := string(message(from, &mail.Address{Address: "growth@example.com"}, to, "Hi", "Line one\nLine two"))

	assert.Contains(t, msg, "Reply-To: <growth@example.com>\r\n")
	assert.Contains(t, msg, `To: "Kim Ek" <kim@example.com>`)
	assert.True(t, strings.HasSuffix(msg, "Line one\r\nLine two"))
	assert.NotContains(t, string(message(from, nil, to, "Hi", "x")), "Reply-To")
}
