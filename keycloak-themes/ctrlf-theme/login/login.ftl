<#-- keycloak-themes/ctrlf-theme/login/login.ftl -->

<#import "template.ftl" as layout>

<@layout.registrationLayout
    displayInfo=false
    displayMessage=false
; section>

  <#if section == "header">
    Group ware

  <#elseif section == "form">

    <div class="ctrlf-login-page">
      <div class="ctrlf-login-main">
        <div class="ctrlf-login-container">
          <div class="ctrlf-login-content">

            <section class="ctrlf-brand-section">
              <div class="ctrlf-company-logo">
                <div class="ctrlf-logo-icon">
                  <img
                    src="${url.resourcesPath}/img/login-logo.png"
                    alt="CTRL Company Hub 로고"
                    class="ctrlf-logo-image"
                  />
                </div>
                <div>
                  <div class="ctrlf-logo-title">CTRL Company Hub</div>
                  <div class="ctrlf-logo-subtitle">통합 업무 관리 시스템</div>
                </div>
              </div>

              <div class="ctrlf-brand-content">
                <h2 class="ctrlf-brand-heading">
                  스마트한 협업으로<br/>
                  <span class="ctrlf-brand-heading-line2">비즈니스를 성장시키세요</span>
                </h2>
                <p class="ctrlf-brand-description">
                  전자결재, 근태관리, 프로젝트 협업까지<br/>
                  하나의 플랫폼에서 모든 업무를 효율적으로 관리하세요
                </p>
              </div>
            </section>

            <div class="ctrlf-divider"></div>

            <section class="ctrlf-form-section">
              <div class="ctrlf-form-container">
                <div class="ctrlf-form-header">
                  <h2 class="ctrlf-form-title">로그인</h2>
                  <p class="ctrlf-form-subtitle">계정 정보를 입력해 주세요</p>
                </div>

                <form id="kc-form-login" class="ctrlf-form" action="${url.loginAction}" method="post">
                  <div class="ctrlf-form-group">
                    <label for="username" class="ctrlf-form-label">아이디</label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      class="ctrlf-form-input"
                      value="${login.username!''}"
                      autocomplete="username"
                      placeholder="아이디(사번)"
                      autofocus
                      required
                    />
                  </div>

                  <div class="ctrlf-form-group">
                    <label for="password" class="ctrlf-form-label">비밀번호</label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      class="ctrlf-form-input"
                      autocomplete="current-password"
                      placeholder="비밀번호"
                      required
                    />
                  </div>

                  <#-- 에러 메시지 -->
                  <#if message?has_content>
                    <div class="ctrlf-error-message">
                      아이디 또는 비밀번호가 올바르지 않습니다.
                    </div>
                  </#if>

                  <div class="ctrlf-form-group ctrlf-submit-group">
                    <button
                      type="submit"
                      class="ctrlf-submit-button"
                      id="kc-login"
                    >
                      로그인
                    </button>
                  </div>
                </form>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>

  </#if>
</@layout.registrationLayout>
