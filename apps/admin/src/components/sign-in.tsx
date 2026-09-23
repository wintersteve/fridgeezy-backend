import { TOKENS } from "@fridgeezy/design";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

import { supabase } from "../lib/supabase";

/**
 * Signing in to the console.
 *
 * ## It is the app's own flow, for the app's own reason
 *
 * An address, then a six-digit code. No password, because there are none:
 * `signInWithOtp` created every account this project has, and GoTrue gives such
 * a user a random password nobody holds — so a password field would be a door
 * that answers `invalid_credentials` to everybody, including the person who
 * owns the account.
 *
 * A code rather than a magic link, for the same reason the app uses one: a link
 * opens a mail client and comes back into a page that has lost its state.
 *
 * ## `shouldCreateUser: false`, and this is the one place it matters most
 *
 * The app passes `true` — signing in IS signing up there. Here it must not:
 * with `true`, typing any address at all would create a real `auth.users` row
 * and mail a code to a stranger. They still could not get in (the admin flag is
 * false and `requireAdmin` answers 404), but the console would be an
 * account-creation and mail-sending endpoint for anyone who found the URL.
 *
 * The cost is that an unknown address gets an error rather than a code, which
 * is the right way round on a tool with a known, tiny list of users.
 */
export function SignIn() {
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [step, setStep] = useState<"email" | "code">("email");
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);

    /**
     * Supabase's own strings never reach the screen.
     *
     * The client's `getAuthErrorMessage` makes the same call and the reason is
     * the same: raw GoTrue messages make a rate limit and a wrong code read
     * alike, and several of them describe the database rather than the person.
     */
    const readable = (message: string): string => {
        const text = message.toLowerCase();

        if (text.includes("rate limit") || text.includes("too many")) {
            return "Too many attempts — wait a minute and try again";
        }

        if (text.includes("expired")) {
            return "That code has expired — send a new one";
        }

        if (text.includes("invalid") || text.includes("token")) {
            return "That code is not right";
        }

        // `shouldCreateUser: false` is what produces this one, and it is the
        // expected answer for a typo as well as for a stranger.
        if (text.includes("signups not allowed") || text.includes("not found")) {
            return "No account for that address";
        }

        return "Could not sign in — try again";
    };

    const sendCode = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);

        const { error: sendError } = await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: { shouldCreateUser: false },
        });

        setBusy(false);

        if (sendError) {
            setError(readable(sendError.message));
            return;
        }

        setStep("code");
    };

    const verify = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);

        const { error: verifyError } = await supabase.auth.verifyOtp({
            email: email.trim(),
            token: code.trim(),
            type: "email",
        });

        setBusy(false);

        if (verifyError) {
            setError(readable(verifyError.message));
            return;
        }

        // Nothing to do on success: the session lands, `onAuthStateChange` in
        // the shell above fires, and this component unmounts. Navigating from
        // here would be a second thing deciding where the console goes.
    };

    return (
        <Box className="signin">
            <Paper sx={{ p: 8, width: "100%", maxWidth: 380, textAlign: "center" }}>
                <div className="wordmark">
                    Fridge<span>ezy</span>
                </div>
                <div className="wordmark-sub">Admin</div>

                {/* A standing condition rather than an event, so it is a banner
                    here and not a toast: it stays until the reader does
                    something about it. */}
                {error ? (
                    <Alert severity="error" sx={{ mt: 6, textAlign: "left" }}>
                        {error}
                    </Alert>
                ) : null}

                {step === "email" ? (
                    <Stack component="form" spacing={4} sx={{ mt: 6 }} onSubmit={sendCode}>
                        <Typography variant="body2" sx={{ color: TOKENS.inkSoft }}>
                            Sign in with the address on your admin account.
                        </Typography>
                        <TextField
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            required
                            autoFocus
                            fullWidth
                        />
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={busy || !email.trim()}
                            fullWidth
                        >
                            {busy ? "Sending…" : "Email me a code"}
                        </Button>
                    </Stack>
                ) : (
                    <Stack component="form" spacing={4} sx={{ mt: 6 }} onSubmit={verify}>
                        <Typography variant="body2" sx={{ color: TOKENS.inkSoft }}>
                            We sent a 6-digit code to <strong>{email}</strong>.
                        </Typography>
                        <TextField
                            value={code}
                            onChange={(event) =>
                                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                            }
                            slotProps={{
                                htmlInput: {
                                    // The browser's own one-time-code autofill,
                                    // which is worth more than anything
                                    // hand-rolled here.
                                    autoComplete: "one-time-code",
                                    inputMode: "numeric",
                                    style: {
                                        textAlign: "center",
                                        fontSize: 22,
                                        letterSpacing: 8,
                                        fontWeight: 600,
                                    },
                                },
                            }}
                            placeholder="000000"
                            required
                            autoFocus
                            fullWidth
                        />
                        <Button
                            type="submit"
                            variant="contained"
                            disabled={busy || code.length < 6}
                            fullWidth
                        >
                            {busy ? "Checking…" : "Sign in"}
                        </Button>
                        <Button
                            variant="text"
                            size="small"
                            onClick={() => {
                                setStep("email");
                                setCode("");
                                setError(undefined);
                            }}
                        >
                            Use a different address
                        </Button>
                    </Stack>
                )}
            </Paper>
        </Box>
    );
}
