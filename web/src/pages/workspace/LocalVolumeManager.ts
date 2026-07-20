import type { LocalVolumeMetadata } from '@/model/LocalVolume';
import { shouldEmbedDownloadMetadata } from '@/model/LocalVolume';
import type { TxtImportPlan } from '@/model/TxtCatalog';
import { TranslateTaskDescriptor } from '@/model/Translator';
import {
  Setting,
  useLocalVolumeStore,
  useSettingStore,
  useWorkspaceStore,
} from '@/stores';
import { downloadFile, querySearch } from '@/util';

type LocalVolumeManagerState = {
  volumes: LocalVolumeMetadata[];
};

export const useLocalVolumeManager = defineStore('LocalVolumeManager', {
  state: (): LocalVolumeManagerState => ({
    volumes: [],
  }),
  actions: {
    async loadVolumes() {
      const repo = await useLocalVolumeStore();
      this.volumes = await repo.listVolume();
      return this.volumes;
    },
    async addVolume(file: File, favoredId: string = 'default') {
      const repo = await useLocalVolumeStore();
      const result = await repo.createVolume(
        file,
        favoredId,
        Setting.normalizeLanguageDetectionConfidencePercent(
          useSettingStore().setting.languageDetectionConfidencePercent,
        ),
      );
      await this.loadVolumes();
      return result;
    },
    async addReviewedTxtVolume(
      file: File,
      plan: TxtImportPlan,
      favoredId: string = 'default',
    ) {
      const repo = await useLocalVolumeStore();
      const result = await repo.createReviewedTxtVolume(
        file,
        favoredId,
        plan,
        Setting.normalizeLanguageDetectionConfidencePercent(
          useSettingStore().setting.languageDetectionConfidencePercent,
        ),
      );
      await this.loadVolumes();
      return result;
    },
    async deleteVolume(id: string) {
      const repo = await useLocalVolumeStore();
      await repo.deleteVolume(id);
      this.volumes = this.volumes.filter((it) => it.id !== id);
    },
    async deleteVolumes(ids: string[]) {
      const repo = await useLocalVolumeStore();

      let failed = 0;
      await Promise.all(
        ids.map(async (id: string) => {
          try {
            await repo.deleteVolume(id);
            this.volumes = this.volumes.filter((it) => it.id !== id);
          } catch (error) {
            failed += 1;
            console.error(`删除错误：${error}\n标题:${id}`);
          }
        }),
      );
      return { success: ids.length - failed, failed };
    },
    async downloadVolumes(ids: string[]) {
      const settingStore = useSettingStore();
      const { setting } = storeToRefs(settingStore);

      const { mode, translationsMode, translations } =
        setting.value.downloadFormat;

      const repo = await useLocalVolumeStore();
      const getDownload = async (id: string) => {
        const volume = await repo.getVolume(id);
        if (volume === undefined) throw new Error('小说不存在');
        return repo.getTranslationFile({
          id,
          mode,
          translationsMode,
          translations,
          embedMetadata: shouldEmbedDownloadMetadata(
            volume,
            'translated',
            setting.value.embedMetadataInTranslatedDownload,
          ),
        });
      };

      if (ids.length === 0) return { success: 0, failed: 0 };

      if (ids.length === 1) {
        try {
          const { filename, blob } = await getDownload(ids[0]!);
          downloadFile(filename, blob);
          return { success: 1, failed: 0 };
        } catch (error) {
          console.error(`生成文件错误：${error}\n标题:${ids[0]}`);
          return { success: 0, failed: 1 };
        }
      }

      const { BlobReader, BlobWriter, ZipWriter } =
        await import('@zip.js/zip.js');
      const zipBlobWriter = new BlobWriter();
      const writer = new ZipWriter(zipBlobWriter);

      let failed = 0;
      await Promise.all(
        ids.map(async (id: string) => {
          try {
            const { filename, blob } = await getDownload(id);
            await writer.add(filename, new BlobReader(blob));
          } catch (error) {
            failed += 1;
            console.error(`生成文件错误：${error}\n标题:${id}`);
          }
        }),
      );

      await writer.close();
      const zipBlob = await zipBlobWriter.getData();
      downloadFile(`批量下载[${ids.length}].zip`, zipBlob);

      return { success: ids.length - failed, failed };
    },

    queueJobToWorkspace(
      id: string,
      {
        level,
        type,
        shouldTop,
        forceMetadata,
        startIndex,
        endIndex,
        taskNumber,
        total,
        formatRetryCount = 3,
      }: {
        level: 'normal' | 'expire' | 'all';
        type: 'gpt' | 'sakura';
        shouldTop: boolean;
        forceMetadata: boolean;
        startIndex: number;
        endIndex: number;
        taskNumber: number;
        total: number;
        formatRetryCount?: number;
      },
    ) {
      const workspace = useWorkspaceStore(type);
      const tasks: string[] = [];
      if (taskNumber > 1) {
        const taskSize = (Math.min(endIndex, total) - startIndex) / taskNumber;
        for (let i = 0; i < taskNumber; i++) {
          const start = Math.round(startIndex + i * taskSize);
          const end = Math.round(startIndex + (i + 1) * taskSize);
          if (end > start) {
            const task = TranslateTaskDescriptor.local(id, {
              level,
              translateMetadata: tasks.length === 0,
              forceMetadata,
              startIndex: start,
              endIndex: end,
              formatRetryCount,
            });
            tasks.push(task);
          }
        }
      } else {
        const task = TranslateTaskDescriptor.local(id, {
          level,
          translateMetadata: true,
          forceMetadata,
          startIndex,
          endIndex,
          formatRetryCount,
        });
        tasks.push(task);
      }
      const results = tasks.map((task) => {
        const job = {
          task,
          description: id,
          createAt: Date.now(),
        };
        const success = workspace.addJob(job);
        if (success && shouldTop) {
          workspace.topJob(job);
        }
        return success;
      });
      return results;
    },
    queueJobsToWorkspace(
      ids: string[],
      {
        level,
        type,
        shouldTop,
        formatRetryCount = 3,
      }: {
        level: 'expire' | 'all';
        type: 'gpt' | 'sakura';
        shouldTop: boolean;
        formatRetryCount?: number;
      },
    ) {
      const workspace = useWorkspaceStore(type);
      let failed = 0;
      ids.forEach((id) => {
        const task = TranslateTaskDescriptor.local(id, {
          level,
          translateMetadata: true,
          forceMetadata: false,
          startIndex: 0,
          endIndex: 65535,
          formatRetryCount,
        });
        const job = {
          task,
          description: id,
          createAt: Date.now(),
        };
        const success = workspace.addJob(job);
        if (success && shouldTop) {
          workspace.topJob(job);
        }
        if (!success) {
          failed += 1;
        }
      });

      return { success: ids.length - failed, failed };
    },
  },
});

export namespace LocalVolumeManagerUtil {
  export const filterAndSortVolumes = (
    volumes: LocalVolumeMetadata[],
    {
      query,
      enableRegexMode,
      order,
    }: {
      query: string;
      enableRegexMode: boolean;
      order: {
        value: 'byCreateAt' | 'byId';
        desc: boolean;
      };
    },
  ) => {
    volumes = querySearch(volumes, 'id', {
      query,
      enableRegexMode,
    });

    return volumes.sort((a, b) => {
      let delta = 0;
      switch (order.value) {
        case 'byId':
          delta = b.id.localeCompare(a.id);
          break;
        case 'byCreateAt': {
          delta = a.createAt - b.createAt;
          break;
        }
        default:
          console.error(`未支持${order.value}排序`);
          break;
      }
      return order.desc ? -delta : delta;
    });
  };
}
