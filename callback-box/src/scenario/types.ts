/**
 * Type definitions for scenario testing.
 */

export interface ScenarioStep {
  name: string;
  run: string;
  time?: string;
  checkpoint?: string;
  validate?: ValidationCheck[];
}

export type ValidationCheck =
  | { committed: true }
  | { script: string }
  | { prompt: string };

export interface ScenarioDefinition {
  name: string;
  description: string;
  steps: ScenarioStep[];
}

export interface StubsDefinition {
  time?: string;
  http?: HttpStub[];
}

export interface HttpStub {
  pattern: string;
  response_file: string;
  status?: number;
  content_type?: string;
  after?: string;
}
