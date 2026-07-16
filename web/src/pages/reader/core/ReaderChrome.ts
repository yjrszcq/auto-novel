export const shouldToggleReaderChrome = ({
  hasOpenPanel,
  hasSelection,
  interactiveTarget,
  relativeX,
  width,
}: {
  hasOpenPanel: boolean;
  hasSelection: boolean;
  interactiveTarget: boolean;
  relativeX: number;
  width: number;
}) =>
  !hasOpenPanel &&
  !hasSelection &&
  !interactiveTarget &&
  relativeX >= width * 0.25 &&
  relativeX <= width * 0.75;

export const getReaderEscapeAction = (hasOpenPanel: boolean) =>
  hasOpenPanel ? ('close-panel' as const) : ('hide-controls' as const);
