export function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function fail(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
