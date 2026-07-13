export const workspaceMenuPaths = [
  '/workspace/toolbox',
  '/workspace/gpt',
  '/workspace/sakura',
  '/workspace/interactive',
];

export const getMainMenuKey = (path: string) => {
  const matchedWorkspace = workspaceMenuPaths.find((item) =>
    path.startsWith(item),
  );
  if (matchedWorkspace) {
    return matchedWorkspace;
  }
  return path === '/' ? '/' : path;
};
