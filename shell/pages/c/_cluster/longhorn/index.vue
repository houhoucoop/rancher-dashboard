<script>
import { mapGetters } from 'vuex';
import { SERVICE, CATALOG } from '@shell/config/types';
import { UI_PLUGIN_NAMESPACE, isSupportedChartVersion } from '@shell/config/uiplugins';
import IconMessage from '@shell/components/IconMessage';
import LazyImage from '@shell/components/LazyImage';
import AsyncButton from '@shell/components/AsyncButton';
import { Banner } from '@components/Banner';
import longhornSvg from '~shell/assets/images/vendor/longhorn.svg';
import Loading from '@shell/components/Loading';
import { getVersionData } from '@shell/config/version';
import {
  getHelmRepositoryExact,
  createHelmRepository,
  getHelmChart,
  installHelmChart,
  waitForUIExtension,
  waitForUIPackage,
} from '@shell/utils/uiplugins';

const LONGHORN_EXT_CHART = 'longhorn';
const LONGHORN_EXT_REPO = {
  NAME:   'longhorn',
  URL:    'https://github.com/houhoucoop/longhorn-extension.git',
  BRANCH: 'gh-pages-dev',
};
const LONGHORN_EXT = {
  name:     LONGHORN_EXT_CHART,
  version:  '',
  repoType: 'cluster',
  repoName: LONGHORN_EXT_REPO.NAME,
};
const INSTALL_WAIT_RETRIES = 40;
const REPOSITORY_POLL_TIMEOUT_MS = 300000;
const REPOSITORY_POLL_INTERVAL_MS = 5000;

export default {
  components: {
    IconMessage, LazyImage, Loading, Banner, AsyncButton
  },

  async fetch() {
    if ( this.$store.getters['cluster/schemaFor'](SERVICE) ) {
      const response = await this.$store.dispatch('cluster/findLabelSelector', {
        type:     SERVICE,
        matching: { labelSelector: { matchLabels: { app: 'longhorn-ui' } } },
        opt:      { transient: true }
      });

      this.uiServices = response.data;
    }
  },

  data() {
    return {
      longhornImgSrc: longhornSvg,
      uiServices:     null,
      installing:     false,
      installStep:    '',
      installError:   null,
      installSuccess: false,
      kubeVersion:    null,
      rancherVersion: getVersionData()?.Version || '',
    };
  },

  computed: {
    ...mapGetters(['currentCluster']),
    hasLonghornExtension() {
      const extensions = this.$store.getters['uiplugins/plugins'] || [];

      return extensions.some((p) => p.name === LONGHORN_EXT_CHART && p.installed && !p.builtin);
    },

    showExtensionPromotion() {
      return this.uiServices && this.uiServices.length > 0 && (!this.hasLonghornExtension || this.installSuccess);
    },

    hasExtensionSupport() {
      try {
        return !!this.$store.getters['features/get']('uiextension');
      } catch (e) {
        return false;
      }
    },

    extensionListLink() {
      return {
        name:   'c-cluster-uiplugins',
        params: { cluster: this.currentCluster?.id || this.$route.params.cluster || '_' },
      };
    },

    extensionPromotionAction() {
      if (!this.hasExtensionSupport) {
        return {
          link:           this.extensionListLink,
          descriptionKey: 'longhorn.overview.extensionPromotion.enableDescription',
          buttonKey:      'longhorn.overview.extensionPromotion.enableButton',
        };
      }

      return {
        hasAction:      true,
        descriptionKey: 'longhorn.overview.extensionPromotion.repoDescription',
        buttonKey:      'longhorn.overview.extensionPromotion.repoButton',
      };
    },

    installProgressKey() {
      if (!this.installStep) {
        return '';
      }

      return `longhorn.overview.extensionPromotion.progress.${ this.installStep }`;
    },

    installStepOrder() {
      return [
        'checkingRepo',
        'syncingCatalog',
        'fetchingVersion',
        'installingExtension',
        'waitingOperation'
      ];
    },

    installActiveStepIndex() {
      return this.installStepOrder.indexOf(this.installStep);
    },

    installTimeline() {
      const activeIndex = this.installActiveStepIndex;

      return this.installStepOrder.map((step, index) => {
        let state = 'pending';

        if (activeIndex >= 0 && index < activeIndex) {
          state = 'done';
        } else if (index === activeIndex) {
          state = this.installError ? 'error' : 'active';
        }

        return {
          step,
          state,
          progressKey: `longhorn.overview.extensionPromotion.progress.${ step }`
        };
      });
    },

    visibleInstallTimeline() {
      return this.installTimeline.filter((item) => item.state !== 'pending');
    },

    showInstallStatusPanel() {
      return this.installing || !!this.installError || this.installSuccess;
    },

    installBannerColor() {
      if (this.installError) {
        return 'error';
      }

      return 'info';
    },

    externalLinks() {
      if ( this.uiServices && this.uiServices.length === 1 && this.uiServices[0].metadata?.namespace ) {
        return [
          {
            enabled:     true,
            iconSrc:     this.longhornImgSrc,
            label:       'longhorn.overview.linkedList.longhorn.label', // i18n-uses longhorn.overview.linkedList.longhorn.label
            description: 'longhorn.overview.linkedList.longhorn.description', // i18n-uses longhorn.overview.linkedList.longhorn.description
            link:        `/k8s/clusters/${ this.currentCluster.id }/api/v1/namespaces/${ this.uiServices[0].metadata.namespace }/services/http:longhorn-frontend:80/proxy/`
          },
        ];
      }

      return [];
    }
  },

  methods: {
    toErrorMessage(error) {
      if (error instanceof Error) {
        return error.message;
      }

      if (typeof error === 'string') {
        return error;
      }

      return this.t('generic.unknownError');
    },

    async onInstallExtensionButton(done) {
      await this.installLonghornExtension(done);
    },

    refreshPage() {
      this.$router.go();
    },

    installStepIcon(state) {
      if (state === 'done') {
        return 'icon-checkmark';
      }

      if (state === 'active') {
        return 'icon-spinner icon-spin';
      }

      if (state === 'error') {
        return 'icon-warning';
      }

      return 'icon-circle';
    },

    async waitForInstalledExtension(maxRetries = 20) {
      const extension = await waitForUIExtension(this.$store, LONGHORN_EXT.name, maxRetries);

      if (!extension) {
        return false;
      }

      return await waitForUIPackage(this.$store, extension, maxRetries);
    },

    async getLatestLonghornExtensionVersion(repository) {
      const chart = await getHelmChart(this.$store, repository, LONGHORN_EXT.name);
      const versions = Array.isArray(chart?.versions) ? chart.versions : (chart ? [chart] : []);
      const compatibleVersions = versions.filter((version) => isSupportedChartVersion({
        version,
        rancherVersion: this.rancherVersion,
        kubeVersion:    this.kubeVersion,
      }));

      return compatibleVersions[0]?.version || versions[0]?.version || chart?.version;
    },

    async waitForRepositoryDownloaded(repositoryId, timeoutMs = REPOSITORY_POLL_TIMEOUT_MS, pollIntervalMs = REPOSITORY_POLL_INTERVAL_MS) {
      const start = Date.now();

      while (true) {
        const latestRepo = await this.$store.dispatch('management/find', {
          type: CATALOG.CLUSTER_REPO,
          id:   repositoryId,
          opt:  { force: true, watch: false }
        });
        const conditions = latestRepo?.status?.conditions || [];
        const downloaded = conditions.find((c) => c.type === 'Downloaded');

        if (downloaded?.status === 'True') {
          return;
        }

        if (Date.now() - start > timeoutMs) {
          throw new Error('Timed out waiting for Helm repository to finish downloading');
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    },

    async installLonghornExtension(done) {
      if (this.installing) {
        done?.('cancelled');

        return;
      }

      this.installError = null;
      this.installSuccess = false;
      this.installing = true;
      this.installStep = 'checkingRepo';

      try {
        let longhornRepository = await getHelmRepositoryExact(this.$store, LONGHORN_EXT_REPO.URL);

        if (!longhornRepository) {
          longhornRepository = await createHelmRepository(
            this.$store,
            LONGHORN_EXT_REPO.NAME,
            LONGHORN_EXT_REPO.URL,
            LONGHORN_EXT_REPO.BRANCH
          );
        }

        this.installStep = 'syncingCatalog';
        const now = (new Date()).toISOString().replace(/\.\d+Z$/, 'Z');

        longhornRepository.spec.forceUpdate = now;
        await longhornRepository.save();
        await this.waitForRepositoryDownloaded(longhornRepository.id);

        this.installStep = 'fetchingVersion';
        const version = await this.getLatestLonghornExtensionVersion(longhornRepository);

        if (!version) {
          throw new Error(this.t('longhorn.overview.extensionPromotion.chartNotFound'));
        }

        this.installStep = 'installingExtension';
        await installHelmChart(
          longhornRepository,
          {
            ...LONGHORN_EXT,
            version,
          },
          {},
          UI_PLUGIN_NAMESPACE,
          'install'
        );

        this.installStep = 'waitingOperation';
        const installed = await this.waitForInstalledExtension(INSTALL_WAIT_RETRIES);

        if (!installed) {
          this.installError = 'Longhorn UI Extension package was not available after installation';
          done?.(false);

          return;
        }

        this.installSuccess = true;
        done?.(true);
      } catch (e) {
        this.installError = this.toErrorMessage(e);
        done?.(false);
      } finally {
        this.installing = false;
        if (!this.installError) {
          this.installStep = '';
        }
      }
    },
  },
};
</script>

<template>
  <Loading v-if="$fetchState.pending" />
  <section v-else>
    <header class="row">
      <div class="col span-12">
        <h1>
          <t k="longhorn.overview.title" />
        </h1>
        <div>
          <t
            k="longhorn.overview.subtitle"
            :raw="true"
          />
        </div>
      </div>
    </header>

    <Banner
      v-if="showExtensionPromotion"
      :color="installBannerColor"
      class="mb-20"
    >
      <template #default>
        <div class="extension-promo">
          <div class="extension-promo__hero">
            <div class="extension-promo__content">
              <p class="mb-0 extension-promo__description">
                <strong>{{ t('longhorn.overview.extensionPromotion.title') }}</strong><br>
                {{ t(extensionPromotionAction.descriptionKey) }}
              </p>
              <div
                v-if="!installSuccess"
                class="extension-promo__action"
              >
                <AsyncButton
                  v-if="extensionPromotionAction.hasAction"
                  mode="install"
                  :disabled="installing"
                  :action-label="t(extensionPromotionAction.buttonKey)"
                  :waiting-label="t('longhorn.overview.extensionPromotion.installingButton')"
                  :success-label="t(extensionPromotionAction.buttonKey)"
                  :error-label="t('longhorn.overview.extensionPromotion.retryButton')"
                  action-color="role-primary"
                  @click="onInstallExtensionButton"
                />
                <router-link
                  v-else
                  :to="extensionPromotionAction.link"
                  class="btn role-primary"
                >
                  {{ t(extensionPromotionAction.buttonKey) }}
                </router-link>
              </div>
            </div>
          </div>

          <div
            v-if="showInstallStatusPanel"
            class="extension-promo__status mt-5"
          >
            <div class="extension-promo__status-title">
              {{ t('longhorn.overview.extensionPromotion.statusTitle') }}
            </div>
            <ul class="extension-promo__timeline">
              <li
                v-for="item in visibleInstallTimeline"
                :key="item.step"
                class="extension-promo__timeline-item"
                :class="[`is-${ item.state }`, `text-${ item.state === 'done' ? 'success' : item.state === 'error' ? 'error' : item.state === 'active' ? 'info' : 'muted'}`]"
              >
                <i
                  class="icon"
                  :class="installStepIcon(item.state)"
                />
                <span class="extension-promo__timeline-label">{{ t(item.progressKey) }}</span>
              </li>
            </ul>

            <div
              v-if="installError"
              class="extension-promo__status-line text-error"
            >
              <i class="icon icon-warning" />
              <span>{{ installError }}</span>
            </div>

            <AsyncButton
              v-if="installError"
              mode="install"
              :action-label="t('longhorn.overview.extensionPromotion.retryButton')"
              :waiting-label="t('longhorn.overview.extensionPromotion.installingButton')"
              :success-label="t('longhorn.overview.extensionPromotion.retryButton')"
              :error-label="t('longhorn.overview.extensionPromotion.retryButton')"
              action-color="role-secondary"
              @click="onInstallExtensionButton"
            />

            <div
              v-if="installSuccess"
              class="extension-promo__status-line"
            >
              <span class="extension-promo__reload-message">Extensions changed - reload required</span>
              <button
                class="btn role-primary"
                @click="refreshPage"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      </template>
    </Banner>

    <div
      v-if="externalLinks && externalLinks.length"
      class="links"
    >
      <div
        v-for="(fel, i) in externalLinks"
        :key="i"
        class="link-container"
      >
        <a
          :href="fel.link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <div class="link-logo">
            <LazyImage :src="fel.iconSrc" />
          </div>
          <div class="link-content">
            <t :k="fel.label" />
            <i class="icon icon-external-link pull-right" />
            <hr role="none">
            <div class="description"><t :k="fel.description" /></div>
          </div>
        </a>
      </div>
    </div>

    <IconMessage
      v-else
      class="mt-40 mb-20"
      icon="icon-longhorn"
      :vertical="true"
    >
      <template #message>
        <p>
          {{ t('longhorn.overview.linkedList.longhorn.uiServiceUnavailable') }}
        </p>
      </template>
    </IconMessage>
  </section>
</template>

<style lang="scss" scoped>
.extension-promo {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.extension-promo__hero {
  display: block;
}

.extension-promo__status {
  border-top: 1px solid var(--border);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.extension-promo__status-title {
  font-weight: 600;
  font-size: 13px;
}

.extension-promo__status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.extension-promo__timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.extension-promo__timeline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
}

.extension-promo__timeline-label {
  line-height: 1.25;
  font-size: 13px;
}

.extension-promo__description {
  flex: 1 1 auto;
  min-width: 0;
  line-height: 1.4;
}

.extension-promo__action {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;

  .btn {
    white-space: nowrap;
  }
}

.extension-promo__reload-message {
  color: #000;
}

@media only screen and (max-width: 768px) {
  .extension-promo__content,
  .extension-promo__action {
    width: 100%;
  }

  .extension-promo__action {
    .btn {
      width: 100%;
    }
  }
}
</style>
