# frozen_string_literal: true
require "test_helper"
require "shopify-cli/theme/config"
require "shopify-cli/theme/theme"

module ShopifyCli
  module Theme
    class ThemeTest < Minitest::Test
      def setup
        super
        config = Config.from_path(ShopifyCli::ROOT + "/test/fixtures/theme")
        @ctx = TestHelpers::FakeContext.new(root: config.root)
        @theme = Theme.new(@ctx, config, id: "123")
      end

      def test_assets
        assert_includes(@theme.asset_paths, Pathname.new("assets/theme.css"))
      end

      def test_theme_files
        assert_includes(@theme.theme_files.map(&:relative_path), Pathname.new("layout/theme.liquid"))
        assert_includes(@theme.theme_files.map(&:relative_path), Pathname.new("templates/blog.json"))
        assert_includes(@theme.theme_files.map(&:relative_path), Pathname.new("locales/en.default.json"))
        assert_includes(@theme.theme_files.map(&:relative_path), Pathname.new("assets/theme.css"))
        assert_includes(@theme.theme_files.map(&:relative_path), Pathname.new("assets/theme.js"))
      end

      def test_get_file
        assert_equal(Pathname.new("layout/theme.liquid"), @theme["layout/theme.liquid"].relative_path)
        assert_equal(Pathname.new("layout/theme.liquid"),
          @theme[Pathname.new("#{ShopifyCli::ROOT}/test/fixtures//theme/layout/theme.liquid")].relative_path)
        assert_equal(@theme.theme_files.first, @theme[@theme.theme_files.first])
      end

      def test_theme_file
        assert(@theme["layout/theme.liquid"].liquid?)
        refute(@theme["layout/theme.liquid"].json?)
        assert(@theme["templates/blog.json"].json?)
        assert(@theme["templates/blog.json"].template?)
        assert(@theme["locales/en.default.json"].json?)
        refute(@theme["locales/en.default.json"].template?)
      end

      def test_is_theme_file
        assert(@theme.theme_file?(@theme["layout/theme.liquid"]))
        assert(@theme.theme_file?(
          @theme[Pathname.new(ShopifyCli::ROOT).join("test/fixtures/theme/layout/theme.liquid")]
        ))
      end

      def test_ignores_file
        assert(@theme.ignore?(@theme["config/settings_data.json"]))
        assert(@theme.ignore?(@theme["config/super_secret.json"]))
        refute(@theme.ignore?(@theme["assets/theme.css"]))
      end

      def test_mime_type
        assert_equal("text/x-liquid", @theme["layout/theme.liquid"].mime_type.name)
        assert_equal("text/css", @theme["assets/theme.css"].mime_type.name)
      end

      def test_text
        assert(@theme["layout/theme.liquid"].mime_type.text?)
      end

      def test_checksum
        content = @theme["layout/theme.liquid"].read
        assert_equal(Digest::MD5.hexdigest(content), @theme["layout/theme.liquid"].checksum)
      end

      def test_normalize_json_for_checksum
        normalized = JSON.parse(@theme["templates/blog.json"].read).to_json
        assert_equal(Digest::MD5.hexdigest(normalized), @theme["templates/blog.json"].checksum)
      end
    end
  end
end
