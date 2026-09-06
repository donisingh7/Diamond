/** Join semantic classes without introducing a second styling system. */
export function cx(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}
