// Unambiguous charset — no 0/O/1/l/I — since an admin may be reading
// this aloud or over WhatsApp to hand it off.
const PASSWORD_CHARS =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

export function generatePassword(length = 14): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join(
    "",
  );
}
