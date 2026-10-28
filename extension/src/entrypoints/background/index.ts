import { defineBackground } from 'wxt/sandbox';
import { AnalysisService } from '../../analysis/service';
import { ALARM_DAILY, ALARM_DRAIN, registerAlarms, runDailyMaintenance } from '../../background/scheduler';
import { FeatureQueue } from '../../background/featureQueue';
import { IngestService } from '../../background/ingest';
import { OffscreenTransport } from '../../background/offscreenTransport';
import { createRouter } from '../../background/router';
import { ClusterService } from '../../clustering/service';
import type { ContentMessage, UiRequest } from '../../core/messages';
import { loadSettings, saveSettings } from '../../core/settings';
import { OPTIONAL_HOST_PERMISSIONS } from '../../manifest';
import { getDb } from '../../storage/db';
import { Repository } from '../../storage/repositories';

export default defineBackground(() => {
  const repo = new Repository(getDb());
  const now = () => Date.now();

  const cluster = new ClusterService(repo, async () => (await loadSettings()).thresholds);
  const analysis = new AnalysisService(repo, async () => {
    const t = (await loadSettings()).thresholds;
    return { minTrendAccounts: t.minTrendAccounts, minBaselinePosts: t.minBaselinePosts, highEngagement: 1000, smallAccountFollowers: 10_000, largeAccountFollowers: 1_000_000 };
  });

  const embeddingsEnabled = async () => {
    const s = await loadSettings();
    return s.modelOptIn && (await chrome.permissions.contains({ origins: OPTIONAL_HOST_PERMISSIONS }));
  };
  const queue = new FeatureQueue(repo, new OffscreenTransport(), cluster, { batchSize: 3, now, embeddingsEnabled });
  const ingest = new IngestService(repo, { notify: () => void queue.drain() });
  const router = createRouter({ repo, ingest, analysis, queue, now, loadSettings, saveSettings });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target === 'offscreen') return false;
    const handler = String(msg?.type).startsWith('ui:')
      ? router.handleUi(msg as UiRequest)
      : router.handleContent(msg as ContentMessage);
    handler.then(
      (data) => sendResponse({ ok: true, data }),
      (e: Error) => sendResponse({ ok: false, error: e.message }),
    );
    return true;
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_DRAIN) void queue.drain();
    if (alarm.name === ALARM_DAILY) {
      void runDailyMaintenance(
        { repo, cluster, analysis, retentionDays: async () => (await loadSettings()).retentionDays },
        now(),
      );
    }
  });

  chrome.runtime.onInstalled.addListener(() => void registerAlarms(chrome.alarms));
  void registerAlarms(chrome.alarms);
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
});
