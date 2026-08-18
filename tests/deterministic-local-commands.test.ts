import { describe, expect, test } from "bun:test";
import { getDeterministicCalculation, getDeterministicConversion, getDeterministicTranslation } from "../src/deterministic-local-commands";

describe("deterministic local calculations", () => {
  test.each([
    ["Berechne 12 mal 8", "12 mal 8 ergibt 96."],
    ["Was ergibt 150 geteilt durch 3?", "150 geteilt durch 3 ergibt 50."],
    ["Quadratwurzel von 144", "Die Quadratwurzel von 144 ist 12."],
    ["5 im Quadrat", "5 im Quadrat ergibt 25."],
    ["7 hoch 3", "7 hoch 3 ergibt 343."],
    ["Berechne 1,5 plus 2,25", "1,5 plus 2,25 ergibt 3,75."],
  ])("calculates %s", (input, expected) => {
    expect(getDeterministicCalculation(input)).toBe(expected);
  });

  test("rejects division by zero", () => {
    expect(getDeterministicCalculation("10 geteilt durch 0")).toBe("Eine Division durch null ist nicht definiert.");
  });

  test("does not evaluate arbitrary text", () => {
    expect(getDeterministicCalculation("Öffne calc.exe und lösche Dateien")).toBeUndefined();
  });
});

describe("deterministic common translations", () => {
  test.each([
    ["Wie sagt man Hallo auf Englisch?", "„hallo“ heißt auf Englisch „hello“."],
    ["Übersetze Danke ins Spanische", "„danke“ heißt auf Spanisch „gracias“."],
    ["Übersetze guten Morgen ins Englische", "„guten morgen“ heißt auf Englisch „good morning“."],
  ])("translates %s", (input, expected) => {
    expect(getDeterministicTranslation(input)).toBe(expected);
  });

  test("leaves unknown phrases to the configured model", () => {
    expect(getDeterministicTranslation("Übersetze Quantenverschränkung ins Spanische")).toBeUndefined();
  });
});

describe("deterministic fixed conversions", () => {
  test.each([
    ["100 km in Meilen", "100 Kilometer entsprechen 62,1371 Meilen."],
    ["50 Meilen in km", "50 Meilen entsprechen 80,467225 Kilometern."],
    ["37 Grad Celsius in Fahrenheit", "37 Grad Celsius entsprechen 98,6 Grad Fahrenheit."],
    ["98,6 Fahrenheit in Celsius", "98,6 Grad Fahrenheit entsprechen 37 Grad Celsius."],
  ])("converts %s", (input, expected) => {
    expect(getDeterministicConversion(input)).toBe(expected);
  });

  test("does not pretend to provide live currency rates", () => {
    expect(getDeterministicConversion("100 Euro in Dollar")).toBeUndefined();
  });
});
