import iconLogo from "../assets/icons/logo_2.svg";
import iconHomeO from "../assets/icons/home_outline.svg";
import iconHomeS from "../assets/icons/home_solid.svg";
import iconProfile from "../assets/icons/profile.svg";
import iconLogout from "../assets/icons/logout.svg";
import { useLocation, useNavigate } from "react-router-dom";
import {
  clearCurrentAudience,
  getCurrentAudience,
} from "../utils/audienceStore.js";
import { bridgeClient } from "../services/bridgeClient.js";
import { logoutCurrentSession } from "../services/sessionLifecycle.js";
import { sessionStore } from "../services/sessionStore.js";

function Sidebar({ inactivityRemainingSeconds }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentAudience = getCurrentAudience();
  const isHomeSelected = pathname === "/jin.d0uble0" || pathname === "/we_r_0";
  const isProfileSelected = pathname === "/my-profile";
  const isProfileSetting = pathname === "/profile-setting";
  const shouldShowReturnCountdown =
    Number.isFinite(inactivityRemainingSeconds) &&
    inactivityRemainingSeconds <= 20;

  const navigateToProfile = () => {
    const currentAudience = getCurrentAudience();

    if (currentAudience?.gender === "female") {
      navigate("/we_r_0");
      return;
    }

    if (currentAudience?.gender === "male") {
      navigate("/jin.d0uble0");
      return;
    }

    navigate("/jin.d0uble0");
  };

  const logBridgeResetError = (message, error) => {
    console.warn(`[BI] ${message}`, {
      code: error?.code,
      message: error?.message,
      status: error?.status,
      retryable: error?.retryable,
      requestId: error?.requestId,
    });
  };

  const returnToStart = async () => {
    try {
      await logoutCurrentSession();
    } catch (error) {
      logBridgeResetError("Return-to-start logout failed", error);
      sessionStore.clear();

      try {
        await bridgeClient.resetActiveSessions();
      } catch (resetError) {
        logBridgeResetError(
          "Return-to-start active session reset failed",
          resetError,
        );
      }
    }

    clearCurrentAudience();
    navigate("/profile-setting", { replace: true });
  };

  return (
    <>
      <nav>
        <div className="nav--section">
          <button
            className="nav--section--btn"
            id="logo"
            type="button"
            aria-disabled={isProfileSetting}
            onClick={isProfileSetting ? undefined : navigateToProfile}
          >
            <div className="nav--section--btn--icon">
              <img src={iconLogo} alt="Logo" />
            </div>
          </button>
        </div>
        <div
          className={`nav--section nav--profile-links${isProfileSetting ? " hidden" : ""}`}
        >
          <button
            className={`nav--section--btn${isHomeSelected ? " selected" : ""}`}
            id="home"
            type="button"
            onClick={navigateToProfile}
          >
            <div className="nav--section--btn--icon">
              <img src={iconHomeO} alt="Home" />
              <img src={iconHomeS} alt="Home" />
            </div>
            <div className="nav--section--btn--text">홈</div>
          </button>
          <button
            className={`nav--section--btn${isProfileSelected ? " selected" : ""}`}
            id="profile"
            type="button"
            onClick={() => navigate("/my-profile")}
          >
            <div className="nav--section--btn--icon">
              <img
                src={currentAudience?.profileImage ?? iconProfile}
                alt="Profile"
              />
            </div>
            <div className="nav--section--btn--text">프로필</div>
          </button>
        </div>
      </nav>
      {!isProfileSetting && (
        <button
          className="return_home_button"
          id="more"
          type="button"
          onClick={returnToStart}
        >
          <img src={iconLogout} alt="" aria-hidden="true" />
          <span>
            {shouldShowReturnCountdown
              ? `${inactivityRemainingSeconds}초 후 처음으로`
              : "처음으로"}
          </span>
        </button>
      )}
    </>
  );
}

export default Sidebar;
