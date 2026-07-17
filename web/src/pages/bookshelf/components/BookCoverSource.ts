export type ResolvedBookCoverSource =
  | { kind: 'external'; url: string }
  | { kind: 'local'; url: string }
  | { kind: 'default'; url: string }
  | { kind: 'text' };

export const resolveBookCoverSource = ({
  externalUrl,
  localUrl,
  defaultUrl,
}: {
  externalUrl?: string;
  localUrl?: string;
  defaultUrl?: string;
}): ResolvedBookCoverSource => {
  const normalizedExternalUrl = externalUrl?.trim();
  if (normalizedExternalUrl) {
    return { kind: 'external', url: normalizedExternalUrl };
  }
  if (localUrl) {
    return { kind: 'local', url: localUrl };
  }
  if (defaultUrl) {
    return { kind: 'default', url: defaultUrl };
  }
  return { kind: 'text' };
};
