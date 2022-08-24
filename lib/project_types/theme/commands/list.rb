# frozen_string_literal: true

require "shopify_cli/theme/theme"
require "project_types/theme/presenters/themes_presenter"

module Theme
  class Command
    class List < ShopifyCLI::Command::SubCommand
      recommend_default_ruby_range

      def call(_args, _name)
        @ctx.puts(@ctx.message("theme.list.title", shop))

        themes_presenter.all.each do |theme|
          @ctx.puts("  #{theme}")
        end
      end

      def self.help
        @ctx.message("theme.list.help", ShopifyCLI::TOOL_NAME, ShopifyCLI::TOOL_NAME)
      end

      private

      def themes_presenter
        Theme::Presenters::ThemesPresenter.new(@ctx, nil)
      end

      def shop
        ShopifyCLI::Theme::ThemeAdminAPI.new(@ctx).get_shop_or_abort
      end
    end
  end
end
