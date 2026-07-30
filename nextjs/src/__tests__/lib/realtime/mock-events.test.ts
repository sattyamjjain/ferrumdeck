import {
  SSE_MOCK_EVENTS_ENV,
  sseMockEventsEnabled,
  startMockEventStream,
  generateMockEvent,
} from "@/lib/realtime/mock-events";

// The five governance events on the run channel whose wire shape the deferred
// gateway->BFF push work depends on.
const GOVERNANCE_EVENTS = [
  "run.forecast.updated",
  "policy.decision.explained",
  "policy.response.recorded",
  "routing.decision.recorded",
  "coherence.divergence.detected",
];

describe("sseMockEventsEnabled", () => {
  it("is OFF when the env var is unset (default, every environment)", () => {
    expect(sseMockEventsEnabled({})).toBe(false);
  });

  it.each(["", "0", "false", "no", "yes", "on", "enabled", "2"])(
    "is OFF for %p (only 1/true enable it)",
    (value) => {
      expect(sseMockEventsEnabled({ [SSE_MOCK_EVENTS_ENV]: value })).toBe(false);
    },
  );

  it.each(["1", "true", "TRUE", "True", " true "])(
    "is ON for %p (case-insensitive, trimmed)",
    (value) => {
      expect(sseMockEventsEnabled({ [SSE_MOCK_EVENTS_ENV]: value })).toBe(true);
    },
  );
});

describe("startMockEventStream", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("returns null and never emits when the flag is unset (10 intervals)", () => {
    const onEvent = jest.fn();
    const timer = startMockEventStream({
      channelType: "run",
      channelName: "run:run_x",
      intervalMs: 1000,
      onEvent,
      env: {},
    });
    expect(timer).toBeNull();
    jest.advanceTimersByTime(10_000);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it.each(["", "0", "false", "yes"])(
    "returns null and never emits for off-value env %p",
    (value) => {
      const onEvent = jest.fn();
      const timer = startMockEventStream({
        channelType: "run",
        channelName: "run:run_x",
        intervalMs: 1000,
        onEvent,
        env: { [SSE_MOCK_EVENTS_ENV]: value },
      });
      expect(timer).toBeNull();
      jest.advanceTimersByTime(10_000);
      expect(onEvent).not.toHaveBeenCalled();
    },
  );

  it.each(["1", "true"])(
    "returns a timer and emits channel-matched events when enabled (env %p)",
    (value) => {
      const onEvent = jest.fn();
      const channelName = "run:run_abc";
      const timer = startMockEventStream({
        channelType: "run",
        channelName,
        intervalMs: 1000,
        onEvent,
        env: { [SSE_MOCK_EVENTS_ENV]: value },
      });
      expect(timer).not.toBeNull();
      jest.advanceTimersByTime(1000);
      expect(onEvent).toHaveBeenCalled();
      const event = onEvent.mock.calls[0][0];
      expect(event.channel).toBe(channelName);
      if (timer) clearInterval(timer);
    },
  );
});

describe("generateMockEvent — run-channel governance wire shapes", () => {
  // Math.random -> index = floor(random * 8) over the 8-entry run eventTypes
  // array; indices 3..7 are the five governance events. Pin each deterministically.
  it.each([
    ["run.forecast.updated", 0.4],
    ["policy.decision.explained", 0.55],
    ["policy.response.recorded", 0.7],
    ["routing.decision.recorded", 0.8],
    ["coherence.divergence.detected", 0.9],
  ] as [string, number][])("produces %s", (type, rand) => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(rand);
    try {
      const event = generateMockEvent("run", "run:run_x");
      expect(event).not.toBeNull();
      if (!event) return;
      expect(event.type).toBe(type);
      expect(event.channel).toBe("run:run_x");
    } finally {
      spy.mockRestore();
    }
  });

  it("produces every governance event type over enough draws (locks the contract)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const event = generateMockEvent("run", "run:run_x");
      if (event) seen.add(event.type);
    }
    for (const type of GOVERNANCE_EVENTS) {
      expect(seen.has(type)).toBe(true);
    }
  });
});
