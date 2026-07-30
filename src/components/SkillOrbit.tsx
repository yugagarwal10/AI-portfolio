import { renderSkillIcon } from "./icons";

interface Skill {
  name: string;
}

interface SkillOrbitProps {
  onSkillClick: (skillName: string) => void;
}

const skills: Skill[] = [
  { name: "Docker" },
  { name: "Redis" },
  { name: "MongoDB" },
  { name: "Node.js" },
  { name: "Python" },
  { name: "AWS" },
  { name: "FastAPI" },
  { name: "Go" }
];

export const SkillOrbit: React.FC<SkillOrbitProps> = ({ onSkillClick }) => {
  return (
    <div className="absolute w-[450px] h-[450px] z-20 pointer-events-none">
      {skills.map((skill, idx) => (
        <div 
          key={idx} 
          className="absolute top-[calc(50%-34px)] left-[calc(50%-34px)]"
          style={{ 
            animation: `orbit-${idx + 1} 32s linear infinite`,
            animationPlayState: "running"
          }}
        >
          <button 
            type="button"
            onClick={() => onSkillClick(skill.name)}
            className="pointer-events-auto flex flex-col items-center justify-center w-[68px] h-[68px] rounded-full glass-panel shadow-md border border-white/80 cursor-pointer hover:scale-120 hover:shadow-[0_0_18px_rgba(124,58,237,0.45)] hover:border-purple-400 transition-all select-none"
          >
            {renderSkillIcon(skill.name)}
            <span className="text-[12.5px] font-black text-zinc-950 tracking-tight mt-1 leading-none">{skill.name}</span>
          </button>
        </div>
      ))}
    </div>
  );
};
