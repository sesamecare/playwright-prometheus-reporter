import fs from 'fs';
import path from 'path';
import http from 'http';

import { Counter, Histogram, register, Pushgateway } from 'prom-client';
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

const labelNames = ['job', 'project', 'suite', 'title', 'location', 'outcome', 'attempt'];

const counter = new Counter({
  name: 'test_run',
  help: 'Metrics about a test run',
  labelNames,
});

const suiteStartCounter = new Counter({
  name: 'test_job_started',
  help: 'Metrics about a test job run',
  labelNames: ['job'],
});

const suiteCompleteCounter = new Counter({
  name: 'test_job_completed',
  help: 'Metrics about a test job run',
  labelNames: ['job', 'outcome'],
});

const stepCounter = new Counter({
  name: 'test_job_steps',
  help: 'Metrics about test steps',
  labelNames: [...labelNames, 'step'],
});

function makeHistogram(buckets: number[] = [0.5, 1, 5, 10, 15, 30, 60]) {
  return new Histogram({
    name: 'test_run_duration',
    help: 'Duration of a test run',
    labelNames,
    buckets,
  });
}

interface ConfigOptions {
  outputFile?: string;
  gateway?: string;
  stdout?: boolean;
  jobName?: string;
  buckets?: number[];
}

// eslint-disable-next-line import/no-default-export
export default class PrometheusReporter implements Reporter {
  config: ConfigOptions;
  histogram: ReturnType<typeof makeHistogram>;
  gateway?: Pushgateway;

  timers: Record<string, ReturnType<(typeof this.histogram)['startTimer']>> = {};

  constructor(options: ConfigOptions = {}) {
    this.config = options;
    this.histogram = makeHistogram(options.buckets);
    if (options.gateway) {
      this.gateway = new Pushgateway(options.gateway);
    }
  }

  get jobName() {
    return this.config.jobName || 'Playwright';
  }

  private location(test: TestCase) {
    const relativePath = path.relative(process.cwd(), test.location.file);
    return `${relativePath}:${test.location.line}`;
  }

  private async pushMetrics() {
    if (this.gateway) {
      try {
        const { resp } = await this.gateway.pushAdd({ jobName: this.jobName });
        return resp as http.IncomingMessage;
      } catch (error) {
        console.error('playwright-prometheus-reporter failed to push metrics', error);
      }
    }
    return undefined;
  }

  onBegin(): void {
    suiteStartCounter.inc(
      {
        job: this.jobName,
      },
      1,
    );
  }

  onTestBegin(test: TestCase): void {
    const { id } = test;
    this.timers[id] = this.histogram.startTimer({
      job: this.jobName,
      suite: test.parent.title,
      project: test.parent.project()?.name,
      location: this.location(test),
      attempt: test.results.length + 1,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    counter.inc(
      {
        job: this.jobName,
        outcome: result.status,
        suite: test.parent.title,
        project: test.parent.project()?.name,
        location: this.location(test),
        attempt: test.results.length,
      },
      1,
    );
    if (this.timers[test.id]) {
      this.timers[test.id]({
        outcome: result.status,
      });
      delete this.timers[test.id];
    }
    this.pushMetrics().catch(() => {
      // Ignore error
    });
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    stepCounter.inc(
      {
        step: step.title,
        job: this.jobName,
        outcome: step.error ? 'failed' : 'passed',
        suite: test.parent.title,
        project: test.parent.project()?.name,
        location: this.location(test),
        attempt: test.results.length,
      },
      1,
    );
  }

  async onEnd(result: FullResult) {
    suiteCompleteCounter.inc(
      {
        job: this.jobName,
        outcome: result.status,
      },
      1,
    );

    const metrics = await register.metrics();
    if (this.config.stdout) {
      console.log(metrics);
    }
    if (this.config.outputFile) {
      fs.writeFileSync(this.config.outputFile, metrics);
    }
    if (this.gateway) {
      try {
        const resp = await this.pushMetrics();
        const { statusCode = 0 } = resp || {};
        if (statusCode >= 200 && statusCode < 300) {
          console.log(`playwright-prometheus-reporter pushed metrics (${statusCode}).`);
        } else {
          console.error(`playwright-prometheus-reporter failed to push metrics (${statusCode}).`);
        }
      } catch (error) {
        console.error('playwright-prometheus-reporter failed to push metrics', error);
      }
    }
  }
}
