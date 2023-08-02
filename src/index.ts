import { Counter, Histogram, register } from 'prom-client';
import type {
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

const labelNames = [
  'project',
  'suite',
  'title',
  'location',
  'outcome',
  'attempt',
]

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

export class PrometheusReporter implements Reporter {
  timers: Record<string, ReturnType<(typeof histogram)['startTimer']>> = {};

  onTestBegin(test: TestCase, result: TestResult): void {
    const { id } = test;
    this.timers[id] = histogram.startTimer({
      suite: test.parent.title,
      project: test.parent.project()?.name,
      location: `${test.location.file}:${test.location.line}`,
      attempt: test.results.length + 1,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    counter.inc({
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
    console.log(metrics);
  }
}
