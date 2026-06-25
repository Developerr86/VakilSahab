export default function SourceBadge({
  source,
}: {
  source: { full_ref?: string; url?: string; title?: string };
}) {
  if (source.full_ref) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-100">
        📜 {source.full_ref}
      </span>
    );
  }
  if (source.url) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 text-xs rounded-full border border-green-100 hover:bg-green-100"
      >
        🔗 {source.title?.slice(0, 40) ?? source.url.slice(0, 40)}
      </a>
    );
  }
  return null;
}