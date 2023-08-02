import fs from 'fs';

import { Counter, Histogram, register, Pushgateway } from 'prom-client';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const labelNames = ['job', 'project', 'suite', 'title', 'location', 'outcome', 'attempt'];

const counter = new Counter({
  name: 'test_run',
  help: 'Metrics about a test run',
  labelNames,
});
const histogram = new Histogram({
  name: 'test_run_duration',
  help: 'Duration of a test run',
  labelNames,
});

interface ConfigOptions {
  outputFile?: string;
  gateway?: string;
  stdout?: boolean;
  jobName?: string;
}

// eslint-disable-next-line import/no-default-export
export default class PrometheusReporter implements Reporter {
  config: ConfigOptions;

  timers: Record<string, ReturnType<(typeof histogram)['startTimer']>> = {};

  constructor(options: ConfigOptions = {}) {
    this.config = options;
  }

  get jobName() {
    return this.config.jobName || 'Playwright';
  }

  onTestBegin(test: TestCase): void {
    const { id } = test;
    this.timers[id] = histogram.startTimer({
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
      await gateway.pushAdd({ jobName: this.jobName });
    }
  }
}
