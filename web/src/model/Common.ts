export type GenericNovelId = { type: 'local'; volumeId: string };

export namespace GenericNovelId {
  export const local = (volumeId: string): GenericNovelId => ({
    type: 'local',
    volumeId,
  });

  export const toString = (gnid: GenericNovelId) => `local/${gnid.volumeId}`;
}
