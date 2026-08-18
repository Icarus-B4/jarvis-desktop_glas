const numberPattern = "(-?\\d+(?:[.,]\\d+)?)";

function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function formatNumber(value: number, maximumFractionDigits = 6): string {
  if (!Number.isFinite(value)) throw new Error("Das Ergebnis ist nicht endlich.");
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits }).format(value);
}

export function getDeterministicCalculation(text: string): string | undefined {
  const value = text.toLowerCase().replace(/[!?]+$/, "").trim();

  const sqrt = value.match(new RegExp(`(?:berechne\\s+)?(?:die\\s+)?quadratwurzel(?:\\s+von)?\\s+${numberPattern}$`, "i"));
  if (sqrt) {
    const operand = parseNumber(sqrt[1]);
    if (operand < 0) return "Die Quadratwurzel einer negativen Zahl ist im Bereich der reellen Zahlen nicht definiert.";
    return `Die Quadratwurzel von ${formatNumber(operand)} ist ${formatNumber(Math.sqrt(operand))}.`;
  }

  const power = value.match(new RegExp(`(?:berechne\\s+)?${numberPattern}\\s+(?:hoch)\\s+${numberPattern}$`, "i"));
  if (power) {
    const base = parseNumber(power[1]);
    const exponent = parseNumber(power[2]);
    return `${formatNumber(base)} hoch ${formatNumber(exponent)} ergibt ${formatNumber(base ** exponent)}.`;
  }

  const square = value.match(new RegExp(`(?:berechne\\s+)?${numberPattern}\\s+(?:im quadrat|zum quadrat)$`, "i"));
  if (square) {
    const operand = parseNumber(square[1]);
    return `${formatNumber(operand)} im Quadrat ergibt ${formatNumber(operand ** 2)}.`;
  }

  const binary = value.match(new RegExp(`(?:berechne\\s+|was (?:ist|ergibt)\\s+)?${numberPattern}\\s*(plus|minus|mal|geteilt durch|[+\\-*/x×÷])\\s*${numberPattern}$`, "i"));
  if (!binary) return undefined;

  const left = parseNumber(binary[1]);
  const operator = binary[2].toLowerCase();
  const right = parseNumber(binary[3]);
  let result: number;
  if (operator === "plus" || operator === "+") result = left + right;
  else if (operator === "minus" || operator === "-") result = left - right;
  else if (["mal", "*", "x", "×"].includes(operator)) result = left * right;
  else {
    if (right === 0) return "Eine Division durch null ist nicht definiert.";
    result = left / right;
  }
  return `${formatNumber(left)} ${operator} ${formatNumber(right)} ergibt ${formatNumber(result)}.`;
}

export function getDeterministicTranslation(text: string): string | undefined {
  const value = text.toLowerCase().replace(/[.!?]+$/, "").trim();
  const match = value.match(/^(?:wie sagt man|übersetze)\s+(.+?)\s+(?:auf|ins|in)\s+(englisch(?:e|en)?|spanisch(?:e|en)?|deutsch(?:e|en)?)$/i);
  if (!match) return undefined;
  const source = match[1].trim();
  const rawLanguage = match[2];
  const language = rawLanguage.startsWith("englisch") ? "englisch" : rawLanguage.startsWith("spanisch") ? "spanisch" : "deutsch";
  const dictionary: Record<string, Record<string, string>> = {
    hallo: { englisch: "hello", spanisch: "hola", deutsch: "hallo" },
    danke: { englisch: "thank you", spanisch: "gracias", deutsch: "danke" },
    bitte: { englisch: "please", spanisch: "por favor", deutsch: "bitte" },
    tschüss: { englisch: "goodbye", spanisch: "adiós", deutsch: "tschüss" },
    "guten morgen": { englisch: "good morning", spanisch: "buenos días", deutsch: "guten Morgen" },
    "guten abend": { englisch: "good evening", spanisch: "buenas tardes", deutsch: "guten Abend" },
    ja: { englisch: "yes", spanisch: "sí", deutsch: "ja" },
    nein: { englisch: "no", spanisch: "no", deutsch: "nein" },
  };
  const translated = dictionary[source]?.[language];
  if (!translated) return undefined;
  return `„${source}“ heißt auf ${language[0].toUpperCase()}${language.slice(1)} „${translated}“.`;
}

export function getDeterministicConversion(text: string): string | undefined {
  const value = text.toLowerCase().replace(/[!?]+$/, "").trim();
  const match = value.match(new RegExp(`(?:rechne\\s+|wandle\\s+)?${numberPattern}\\s*(kilometer|km|meilen|mile|miles|grad celsius|celsius|°c|grad fahrenheit|fahrenheit|°f)\\s+(?:in|zu)\\s+(kilometer|km|meilen|mile|miles|grad celsius|celsius|°c|grad fahrenheit|fahrenheit|°f)$`, "i"));
  if (!match) return undefined;

  const amount = parseNumber(match[1]);
  const source = match[2].toLowerCase();
  const target = match[3].toLowerCase();
  const isKm = (unit: string) => unit === "km" || unit === "kilometer";
  const isMiles = (unit: string) => ["meilen", "mile", "miles"].includes(unit);
  const isCelsius = (unit: string) => ["grad celsius", "celsius", "°c"].includes(unit);
  const isFahrenheit = (unit: string) => ["grad fahrenheit", "fahrenheit", "°f"].includes(unit);

  if (isKm(source) && isMiles(target)) {
    return `${formatNumber(amount)} Kilometer entsprechen ${formatNumber(amount * 0.621371)} Meilen.`;
  }
  if (isMiles(source) && isKm(target)) {
    return `${formatNumber(amount)} Meilen entsprechen ${formatNumber(amount / 0.621371)} Kilometern.`;
  }
  if (isCelsius(source) && isFahrenheit(target)) {
    return `${formatNumber(amount)} Grad Celsius entsprechen ${formatNumber((amount * 9) / 5 + 32)} Grad Fahrenheit.`;
  }
  if (isFahrenheit(source) && isCelsius(target)) {
    return `${formatNumber(amount)} Grad Fahrenheit entsprechen ${formatNumber(((amount - 32) * 5) / 9)} Grad Celsius.`;
  }
  return "Quell- und Zieleinheit müssen unterschiedlich und kompatibel sein.";
}
