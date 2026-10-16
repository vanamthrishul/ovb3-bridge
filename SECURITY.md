# Security policy

OVB3 handles credentials (VB Studio personal access tokens, VBCS/IDCS
passwords), so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
private reporting instead: the **Security** tab of this repository →
**Report a vulnerability**.

Include what you found, how to reproduce it, and the version
(`npm view ovb3-bridge version`, or the plugin version in `/plugin`). You'll get
a reply as soon as practical; this is a one-person project, so please allow a
few days.

## Supported versions

Only the latest release on npm receives fixes.

## What the tool does with secrets

- Credentials are read from the plugin config (stored in your system keychain),
  environment variables, or a local `.env` file that is git-ignored.
- Git credentials are sent as a scoped HTTP header for the one remote being
  used. They are never written into URLs, logs or `.git/config`.
- Log output and error messages are passed through a redactor that masks
  tokens and passwords.
- Nothing is sent anywhere except the Oracle / git hosts you configure.

## For users

- Use a **dedicated personal access token** per machine with only the access you
  need, and revoke it when you stop using that machine.
- Never paste tokens or passwords into a chat, issue or pull request.
- Only install this tool from `vanamthrishul/ovb3-bridge` (plugin) or the
  `ovb3-bridge` package on npm. Look-alike copies are not mine.
