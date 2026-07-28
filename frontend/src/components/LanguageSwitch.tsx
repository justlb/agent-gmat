import { useTranslation } from "react-i18next"

const STYLE = `
.language-switch {
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 2px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  padding: 2px;
}
.language-switch button {
  min-width: 38px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #5d5d62;
  cursor: pointer;
  font-size: 12px;
  font-weight: 750;
}
.language-switch button.active {
  background: #1d1d1f;
  color: white;
}
`

export function LanguageSwitch() {
  const { i18n, t } = useTranslation()
  const currentLanguage = (i18n.language ?? "zh").startsWith("en") ? "en" : "zh"

  return (
    <div className="language-switch" aria-label={t("common.language")}>
      <style>{STYLE}</style>
      {(["zh", "en"] as const).map(language => (
        <button
          type="button"
          className={currentLanguage === language ? "active" : undefined}
          aria-pressed={currentLanguage === language}
          title={t("common.languageToggle")}
          key={language}
          onClick={() => i18n.changeLanguage(language)}
        >
          {language === "zh" ? "中" : "EN"}
        </button>
      ))}
    </div>
  )
}
