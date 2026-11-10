// The desktop assistant is usable only by a browser on the local machine.
export function desktopChatAvailable(host: string | null) {
  return !process.env.VERCEL && process.env.NEUROFILAMENT_PUBLIC_ONLY !== "true"
    && host !== null && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}
