import { isRichTextEmpty, sanitizeRichTextHtml } from './richText';

type Props = {
  value?: string;
  fallback?: string;
  className?: string;
  compact?: boolean;
};

export default function RichTextContent({ value = '', fallback = '-', className = '', compact = false }: Props) {
  if (isRichTextEmpty(value)) return <span className={className}>{fallback}</span>;
  // Safe insertion: sanitizeRichTextHtml rebuilds a strict formatting-only DOM and copies no event or URL attributes.
  return <div className={`rich-text-content${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(value) }} />;
}
