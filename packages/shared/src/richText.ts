export type RichTextNode = {
  nodeType: string;
  value?: string;
  marks?: Array<{ type: string }>;
  data?: Record<string, unknown>;
  content?: RichTextNode[];
};

export type RichTextPath = number[];

export type RichTextSegment = {
  segmentId: string;
  path: RichTextPath;
  text: string;
  marks: string[];
};

const isTextNode = (node: RichTextNode): boolean =>
  node.nodeType === "text" && typeof node.value === "string";

export const buildSegmentId = (fieldId: string, path: RichTextPath): string =>
  `${fieldId}:${path.join(".")}`;

export function extractRichTextSegments(
  fieldId: string,
  root: RichTextNode,
): RichTextSegment[] {
  const segments: RichTextSegment[] = [];

  const visit = (node: RichTextNode, path: number[]) => {
    if (isTextNode(node)) {
      segments.push({
        segmentId: buildSegmentId(fieldId, path),
        path,
        text: node.value ?? "",
        marks: node.marks?.map((mark) => mark.type) ?? [],
      });
    }

    node.content?.forEach((child, index) => {
      visit(child, [...path, index]);
    });
  };

  visit(root, []);

  return segments;
}

export function updateRichTextSegment(
  root: RichTextNode,
  path: RichTextPath,
  nextText: string,
): RichTextNode {
  if (path.length === 0) {
    if (!isTextNode(root)) {
      throw new Error("Cannot update a non-text node at root path");
    }

    return {
      ...root,
      value: nextText,
    };
  }

  const [head, ...tail] = path;

  if (!root.content?.[head]) {
    throw new Error(`Invalid rich text path: ${path.join(".")}`);
  }

  const nextChild = updateRichTextSegment(root.content[head], tail, nextText);
  const nextContent = [...root.content];
  nextContent[head] = nextChild;

  return {
    ...root,
    content: nextContent,
  };
}
