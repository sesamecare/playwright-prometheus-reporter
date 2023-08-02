import type { TestCase, TestResult } from '@playwright/test/reporter';
import { PrometheusReporter } from './index';

type FullProject = ReturnType<TestCase['parent']['project']>;

describe('should collect metrics', () => {
  it('should count', async () => {
    const reporter = new PrometheusReporter();

    const testCase = {
      title: 'fake test',
      location: {
        file: 'fake file',
        line: 5,
      },
      results: [] as TestResult[],
      parent: {
        project: () =>
          ({
            title: 'fake project',
          } as unknown as FullProject),
        title: 'fake suite',
      } as unknown as TestCase['parent'],
    } as TestCase;

    reporter.onTestBegin(testCase, {} as TestResult);
    await new Promise((resolve) => setTimeout(resolve, 100));
    reporter.onTestEnd(testCase, { status: 'passed' } as TestResult);
    const metrics = await reporter.onEnd();
    console.log(metrics);
  });
});
