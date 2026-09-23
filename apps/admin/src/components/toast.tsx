import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";

/**
 * What the console says about a press.
 *
 * ## An EVENT is a toast; a CONDITION is chrome
 *
 * The split is the same one the mobile client's status rail records, and it is
 * the reason this replaced an inline banner rather than joining it. A banner
 * pinned under the page heading says what happened *there*, which on the recipe
 * detail page means the reader presses "Regenerate" at the foot of a long form,
 * the answer lands eight hundred pixels above them, and the only sign of it is
 * the page having failed to do anything visible. A snackbar follows the reader.
 *
 * What stays a banner is anything STANDING: a list that could not be read
 * (`ResourceState`), the rename warning beside the picture. Those are true for
 * as long as they are on screen and would be wrong to time out.
 *
 * ## One at a time, newest wins
 *
 * A stack is what you build when several unrelated things can complete at once,
 * and in a console driven by one person's presses they cannot. Two visible
 * toasts is instead how the SECOND answer to one press is hidden behind the
 * first — so a later notice replaces the one before it, and the reader reads
 * the newest thing rather than the oldest.
 *
 * MUI's `Snackbar` owns the placement, the transition, the timer and the
 * `role="status"` live region; what is left here is the queue rule above and
 * how long each tone stays.
 */

export type ToastTone = "ok" | "error" | "warn";

interface Toast {
    /** Bumped per notice, so repeating the same words still re-announces. */
    id: number;
    tone: ToastTone;
    text: string;
}

interface ToastApi {
    show: (tone: ToastTone, text: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

/**
 * How long a notice stays up, by how much there is to do about it.
 *
 * A success is read in a glance and its consequence is on the page behind it.
 * A failure names something that has to be understood before it can be acted
 * on — and is the one a reader is most likely to have looked away from — so it
 * gets twice as long. Neither is a limit on reading it: the toast is
 * dismissible, and MUI pauses the clock while the pointer is over it.
 */
const DWELL_MS: Record<ToastTone, number> = { ok: 3500, warn: 6000, error: 7000 };

/** The console's tones onto MUI's severities. */
const SEVERITY = { ok: "success", warn: "warning", error: "error" } as const;

export function ToastHost({ children }: { children: ReactNode }) {
    const [toast, setToast] = useState<Toast>();
    const nextId = useRef(0);

    const show = useCallback((tone: ToastTone, text: string) => {
        setToast({ id: ++nextId.current, tone, text });
    }, []);

    const api = useMemo(() => ({ show }), [show]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <Snackbar
                // Keyed on the id so a second notice inside the window
                // re-mounts the snackbar rather than inheriting the first one's
                // remaining time — without it a quick second press reads as
                // having produced no answer at all.
                key={toast?.id}
                open={Boolean(toast)}
                autoHideDuration={toast ? DWELL_MS[toast.tone] : null}
                onClose={(_event, reason) => {
                    // `clickaway` fires on any press anywhere, which would take
                    // the answer away as the reader carries on working.
                    if (reason !== "clickaway") setToast(undefined);
                }}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            >
                {/* Bottom-trailing rather than top-centre: the presses that
                    raise one are at the foot of a form or on a row well down a
                    table, and a notice at the top of the page is what the
                    banner it replaced got wrong. */}
                <Alert
                    severity={toast ? SEVERITY[toast.tone] : "success"}
                    variant="standard"
                    onClose={() => setToast(undefined)}
                    sx={{ maxWidth: 420, boxShadow: 3 }}
                >
                    {toast?.text}
                </Alert>
            </Snackbar>
        </ToastContext.Provider>
    );
}

/**
 * Throws outside the host rather than degrading to a no-op: a console that
 * silently stopped reporting whether a nine-dollar render succeeded is a worse
 * failure than one that will not start.
 */
export function useToast(): ToastApi {
    const api = useContext(ToastContext);

    if (!api) throw new Error("useToast used outside ToastHost");

    return api;
}
