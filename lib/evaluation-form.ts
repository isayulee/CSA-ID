export const evaluationFormUrl = "https://forms.gle/y1EeQ5sQoAY2W9fq7";
export const evaluationFormAction = "https://docs.google.com/forms/d/e/1FAIpQLScvAgL9jn0moOrprj9ySCkOS9PSV6qpJV4lvBnbbHYjmD5D1g/viewform";

export function isCsaEvaluationForm(value: string) {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const formUrl = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  return formUrl === evaluationFormUrl || formUrl === evaluationFormAction;
}
