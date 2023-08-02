import fs from 'fs';
import http from 'http';

import { Counter, Histogram, register, Pushgateway } from 'prom-client';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const labelNames = ['job', 'project', 'suite', 'title', 'location', 'outcome', 'attempt'];

const counter = new Counter({
  name: 'test_run',
  help: 'Metrics about a test run',
  labelNames,
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

  timers: Record<string, ReturnType<(typeof this.histogram)['startTimer']>> = {};

  constructor(options: ConfigOptions = {}) {
    this.config = options;
    this.histogram = makeHistogram(options.buckets);
  }

  get jobName() {
    return this.config.jobName || 'Playwright';
  }

  onTestBegin(test: TestCase): void {
    const { id } = test;
    this.timers[id] = this.histogram.startTimer({
      job: this.jobName,
      suite: test.parent.title,
      project: test.parent.project()?.name,
      location: `${test.location.file}:${test.location.line}`,
      attempt: test.results.length + 1,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    counter.inc({
      job: this.jobName,
      outcome: result.status,
      suite: test.parent.title,
      project: test.parent.project()?.name,
      location: `${test.location.file}:${test.location.line}`,
      attempt: test.results.length,
    });
    if (this.timers[test.id]) {
      this.timers[test.id]({
        outcome: result.status,
      });
      delete this.timers[test.id];
    }
  }

  async onEnd() {
    const metrics = await register.metrics();
    if (this.config.stdout) {
      console.log(metrics);
    }
    if (this.config.outputFile) {
      fs.writeFileSync(this.config.outputFile, metrics);
    }
    if (this.config.gateway) {
      const gateway = new Pushgateway(this.config.gateway);
      try {
        const { resp } = await gateway.pushAdd({ jobName: this.jobName });
        const { statusCode = 0 } = resp as http.IncomingMessage;
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
