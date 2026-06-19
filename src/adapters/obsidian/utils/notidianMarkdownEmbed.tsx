import { NotidianEmbed } from "core/react/components/NotidianEmbed/NotidianEmbed";
import {
  parseNotidianEmbedBlock,
} from "core/utils/embeds/notidianEmbed";
import type { NotidianEmbedDescriptorError } from "core/utils/embeds/notidianEmbed";
import type MakeMDPlugin from "main";
import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import React from "react";
import type { Root } from "react-dom/client";

const errorMessage = (errors: NotidianEmbedDescriptorError[]) =>
  errors.map((error) => `${error.field}: ${error.message}`).join("; ");

class NotidianEmbedRenderChild extends MarkdownRenderChild {
  root: Root | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly plugin: MakeMDPlugin,
    private readonly source: string,
    private readonly ctx: MarkdownPostProcessorContext
  ) {
    super(containerEl);
  }

  onload() {
    const parsed = parseNotidianEmbedBlock(this.source);
    this.containerEl.classList.add("mk-notidian-embed-host");
    this.root = this.plugin.ui.createRoot(this.containerEl);
    if (parsed.ok === false) {
      this.root.render(
        <NotidianEmbed
          superstate={this.plugin.superstate}
          sourcePath={this.ctx.sourcePath}
          host="markdown"
          error={{ message: errorMessage(parsed.errors) }}
        />
      );
      return;
    }

    this.root.render(
      <NotidianEmbed
        superstate={this.plugin.superstate}
        sourcePath={this.ctx.sourcePath}
        host="markdown"
        descriptor={parsed.descriptor}
      />
    );
  }

  onunload() {
    this.root?.unmount();
    this.root = null;
  }
}

export const registerNotidianMarkdownEmbedProcessor = (
  plugin: MakeMDPlugin
) => {
  plugin.registerMarkdownCodeBlockProcessor(
    "notidian",
    (source, element, ctx) => {
      ctx.addChild(new NotidianEmbedRenderChild(element, plugin, source, ctx));
    }
  );
};
